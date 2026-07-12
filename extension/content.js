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

  // Fallback when the interceptor couldn't read the submit request body: LeetCode's
  // own API returns the full submission (code, lang, stats) by id.
  async function fetchSubmissionDetails(submissionId) {
    const data = await graphql(
      `query submissionDetails($submissionId: Int!) {
         submissionDetails(submissionId: $submissionId) {
           code timestamp runtimeDisplay memoryDisplay
           runtimePercentile memoryPercentile
           lang { name }
           question { titleSlug }
         }
       }`,
      { submissionId: Number(submissionId) }
    );
    return data.submissionDetails;
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

  // Poll LeetCode's check endpoint until the judge finishes. Same-origin fetch with
  // the user's session — independent of how the page itself retrieves results.
  async function pollVerdict(submissionId) {
    for (let i = 0; i < 40; i++) {
      try {
        const resp = await fetch(`https://leetcode.com/submissions/detail/${submissionId}/check/`, {
          credentials: 'include',
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json.state === 'SUCCESS') return json;
        }
      } catch { /* transient network blip — keep polling */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error('timed out waiting for the verdict');
  }

  async function handleSubmitted(p) {
    if (!contextAlive()) return;
    try {
      const json = await pollVerdict(p.submissionId);
      console.log('[Grindlog] verdict for submission', p.submissionId, '→', json.status_msg);
      if (json.status_msg === 'Accepted') {
        await handleAccepted({
          ...p,
          stats: {
            runtime: json.status_runtime || null,
            memory: json.status_memory || null,
            runtimeBeats: json.runtime_percentile != null ? Math.round(json.runtime_percentile * 100) / 100 : null,
            memoryBeats: json.memory_percentile != null ? Math.round(json.memory_percentile * 100) / 100 : null,
          },
        });
      } else if (json.status_msg) {
        await recordFailedAttempt(p.slug || currentSlug());
      }
    } catch (e) {
      console.log('[Grindlog] verdict polling failed:', e.message);
      toast(`Grindlog: ${e.message}`, false);
    }
  }

  async function handleAccepted(p) {
    if (!contextAlive()) return; // orphaned script — the fresh one will handle it
    console.log('[Grindlog] accepted event for submission', p.submissionId, p.code ? '(code captured)' : '(fetching code from API)');
    try {
      // Body capture can miss (non-string request bodies, races) — recover the
      // submission from LeetCode's API so the push never depends on interception luck.
      if (!p.code && p.submissionId) {
        const det = await fetchSubmissionDetails(p.submissionId);
        if (!det || !det.code) throw new Error('could not retrieve submission code from LeetCode');
        p.code = det.code;
        p.lang = p.lang || (det.lang && det.lang.name) || 'unknown';
        p.slug = p.slug || (det.question && det.question.titleSlug);
        if (det.timestamp) p.submittedAt = det.timestamp * 1000;
        p.stats = {
          runtime: p.stats.runtime || det.runtimeDisplay || null,
          memory: p.stats.memory || det.memoryDisplay || null,
          runtimeBeats: p.stats.runtimeBeats ?? (det.runtimePercentile != null ? Math.round(det.runtimePercentile * 100) / 100 : null),
          memoryBeats: p.stats.memoryBeats ?? (det.memoryPercentile != null ? Math.round(det.memoryPercentile * 100) / 100 : null),
        };
      }
      if (!p.slug) throw new Error('could not determine which problem was submitted');
      const [meta, daily, track] = await Promise.all([
        fetchQuestionMeta(p.slug),
        fetchDailySlugAndDate(),
        getTrack(p.slug),
      ]);

      const extra = {};
      if (track) {
        extra.failedAttempts = track.failedAttempts;
        const minutes = Math.max(1, Math.round((p.submittedAt - track.openedAt) / 60000));
        // Beyond 8h the tab was likely just left open across sessions — the number
        // is meaningless, so omit it rather than record "Solved in 2880 min".
        if (minutes <= 480) extra.minutes = minutes;
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
      console.log('[Grindlog] push result:', response);

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
    if (e.data.type === 'submitted') handleSubmitted(e.data.payload);
  });

  console.log('[Grindlog] content script ready on', window.location.pathname);
})();
