// Isolated-world content script. Receives events from interceptor.js (page world),
// enriches them with problem metadata from LeetCode's GraphQL API, and hands the
// full payload to background.js for the GitHub push. Also tracks time-to-solve and
// failed attempts per problem, and shows an on-page toast with the push result.
(() => {
  const SOURCE = 'grindlog';
  const libReady = import(chrome.runtime.getURL('lib/format.js'));

  // When the extension is reloaded/updated, content scripts in already-open tabs are
  // orphaned: their chrome.* APIs throw "Extension context invalidated". Detect that
  // and shut down quietly instead of spraying console errors.
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function currentSlug() {
    const m = window.location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  // ---- attempt / time tracking (chrome.storage.local, keyed per slug) ----

  function trackKey(slug) {
    return `track:${slug}`;
  }

  async function getTrack(slug) {
    if (!contextAlive()) return null;
    const key = trackKey(slug);
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  }

  async function ensureTrackStarted(slug) {
    if (!slug || !contextAlive()) return;
    if (!(await getTrack(slug))) {
      await chrome.storage.local.set({ [trackKey(slug)]: { openedAt: Date.now(), failedAttempts: 0 } });
    }
  }

  async function recordFailedAttempt(slug) {
    if (!slug || !contextAlive()) return;
    const track = (await getTrack(slug)) || { openedAt: Date.now(), failedAttempts: 0 };
    track.failedAttempts += 1;
    await chrome.storage.local.set({ [trackKey(slug)]: track });
  }

  async function clearTrack(slug) {
    if (slug && contextAlive()) await chrome.storage.local.remove(trackKey(slug));
  }

  ensureTrackStarted(currentSlug());
  // LeetCode is a SPA — watch for slug changes without a full page load.
  let lastPath = window.location.pathname;
  const spaWatcher = setInterval(() => {
    if (!contextAlive()) {
      clearInterval(spaWatcher); // orphaned by an extension reload — stand down
      return;
    }
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      ensureTrackStarted(currentSlug()).catch(() => {});
    }
  }, 2000);

  // ---- LeetCode GraphQL ----

  async function graphql(query, variables) {
    const resp = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) throw new Error(`LeetCode GraphQL error: HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.errors) throw new Error(`LeetCode GraphQL error: ${json.errors[0].message}`);
    return json.data;
  }

  async function fetchQuestionMeta(slug) {
    const data = await graphql(
      `query q($titleSlug: String!) {
         question(titleSlug: $titleSlug) {
           questionFrontendId title titleSlug content difficulty hints
           topicTags { name }
         }
       }`,
      { titleSlug: slug }
    );
    const q = data.question;
    const { htmlToMarkdown } = await libReady;
    return {
      frontendId: q.questionFrontendId,
      title: q.title,
      slug: q.titleSlug,
      difficulty: q.difficulty,
      topics: (q.topicTags || []).map((t) => t.name),
      hints: q.hints || [],
      contentMd: q.content ? htmlToMarkdown(q.content) : '',
      url: `https://leetcode.com/problems/${q.titleSlug}/`,
    };
  }

  async function fetchDailySlugAndDate() {
    try {
      const data = await graphql(
        `query { activeDailyCodingChallengeQuestion { date question { titleSlug } } }`
      );
      const d = data.activeDailyCodingChallengeQuestion;
      return d ? { date: d.date, slug: d.question.titleSlug } : null;
    } catch {
      return null;
    }
  }

  // ---- toast ----

  function toast(message, ok) {
    const el = document.createElement('div');
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed', top: '70px', right: '20px', zIndex: 999999,
      padding: '12px 18px', borderRadius: '8px', fontSize: '14px',
      fontFamily: 'system-ui, sans-serif', color: '#fff', maxWidth: '340px',
      background: ok ? '#2cbb5d' : '#ef4743',
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
      transition: 'opacity 0.4s', opacity: '1',
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 5000);
    setTimeout(() => el.remove(), 5600);
  }

  // ---- main flow ----

  async function handleAccepted(p) {
    if (!contextAlive()) return; // orphaned script — the fresh one will handle it
    try {
      const [meta, daily, track] = await Promise.all([
        fetchQuestionMeta(p.slug),
        fetchDailySlugAndDate(),
        getTrack(p.slug),
      ]);

      const extra = {};
      if (track) {
        extra.failedAttempts = track.failedAttempts;
        extra.minutes = Math.max(1, Math.round((p.submittedAt - track.openedAt) / 60000));
      }
      if (daily && daily.slug === p.slug) extra.dailyDate = daily.date;

      const response = await chrome.runtime.sendMessage({
        type: 'PUSH_SOLUTION',
        payload: {
          slug: p.slug,
          lang: p.lang,
          code: p.code,
          submittedAt: p.submittedAt,
          stats: p.stats,
          meta,
          extra,
        },
      });

      if (response && response.ok) {
        await clearTrack(p.slug);
        toast(
          response.skipped
            ? 'Grindlog: identical solution already in repo — skipped.'
            : `Grindlog: pushed ${response.file} ✔`,
          true
        );
      } else if (response && response.queued) {
        await clearTrack(p.slug);
        toast(`Grindlog: push failed (${response.error}). Queued for retry.`, false);
      } else {
        toast(`Grindlog: ${response ? response.error : 'no response from background'}`, false);
      }
    } catch (e) {
      toast(`Grindlog error: ${e.message}`, false);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SOURCE) return;
    if (e.data.type === 'accepted') handleAccepted(e.data.payload);
    else if (e.data.type === 'attempt') recordFailedAttempt(e.data.payload.slug);
  });
})();
