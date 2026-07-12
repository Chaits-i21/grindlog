// Options page: settings + one-time backfill of past accepted submissions.
import { htmlToMarkdown } from './lib/format.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const backfillStatusEl = $('backfill-status');

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
}

// ---- settings ----

async function loadSettings() {
  const cfg = await chrome.storage.sync.get(['token', 'owner', 'repo', 'branch']);
  $('token').value = cfg.token || '';
  $('owner').value = cfg.owner || '';
  $('repo').value = cfg.repo || '';
  $('branch').value = cfg.branch || 'main';
}

$('save').addEventListener('click', async () => {
  const cfg = {
    token: $('token').value.trim(),
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main',
  };
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    setStatus(statusEl, 'Token, owner and repo are all required.', false);
    return;
  }
  await chrome.storage.sync.set(cfg);
  setStatus(statusEl, 'Saved.', true);
});

$('test').addEventListener('click', async () => {
  setStatus(statusEl, 'Testing…', true);
  const resp = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });
  if (resp.ok) {
    setStatus(statusEl, `Connected to ${resp.repo} (${resp.private ? 'private' : 'public'}).`, true);
  } else {
    setStatus(statusEl, `Connection failed: ${resp.error}`, false);
  }
});

// ---- backfill ----

let stopRequested = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function leetcodeGraphql(query, variables) {
  const resp = await fetch('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`LeetCode API HTTP ${resp.status} — are you logged in to leetcode.com?`);
  const json = await resp.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

const metaCache = new Map();
async function fetchMeta(slug) {
  if (metaCache.has(slug)) return metaCache.get(slug);
  const data = await leetcodeGraphql(
    `query q($titleSlug: String!) {
       question(titleSlug: $titleSlug) {
         questionFrontendId title titleSlug content difficulty hints
         topicTags { name }
       }
     }`,
    { titleSlug: slug }
  );
  const q = data.question;
  const meta = {
    frontendId: q.questionFrontendId,
    title: q.title,
    slug: q.titleSlug,
    difficulty: q.difficulty,
    topics: (q.topicTags || []).map((t) => t.name),
    hints: q.hints || [],
    contentMd: q.content ? htmlToMarkdown(q.content) : '',
    url: `https://leetcode.com/problems/${q.titleSlug}/`,
  };
  metaCache.set(slug, meta);
  return meta;
}

async function* allAcceptedSubmissions() {
  let offset = 0;
  const limit = 20;
  while (true) {
    const resp = await fetch(`https://leetcode.com/api/submissions/?offset=${offset}&limit=${limit}`, {
      credentials: 'include',
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Not logged in to leetcode.com — open leetcode.com, log in, then retry.');
    }
    if (!resp.ok) throw new Error(`LeetCode submissions API HTTP ${resp.status}`);
    const json = await resp.json();
    const items = json.submissions_dump || [];
    for (const s of items) {
      if (s.status_display === 'Accepted' && s.code) yield s;
    }
    if (!json.has_next || items.length === 0) return;
    offset += limit;
    await sleep(1000); // be gentle with LeetCode's API
  }
}

$('backfill').addEventListener('click', async () => {
  const cfg = await chrome.storage.sync.get(['token', 'owner', 'repo']);
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    setStatus(backfillStatusEl, 'Configure and save your GitHub settings first.', false);
    return;
  }
  stopRequested = false;
  $('backfill').disabled = true;
  $('backfill-stop').disabled = false;

  let pushed = 0, skipped = 0, failed = 0, seen = 0;
  const report = () =>
    setStatus(backfillStatusEl,
      `Processed ${seen} accepted submissions — pushed ${pushed}, skipped ${skipped} duplicates, ${failed} failed.`, true);

  try {
    // Oldest-first keeps commit history in chronological order.
    const all = [];
    setStatus(backfillStatusEl, 'Fetching submission history…', true);
    for await (const s of allAcceptedSubmissions()) {
      all.push(s);
      setStatus(backfillStatusEl, `Fetching submission history… ${all.length} accepted found.`, true);
      if (stopRequested) break;
    }
    all.reverse();

    for (const s of all) {
      if (stopRequested) break;
      seen += 1;
      try {
        const meta = await fetchMeta(s.title_slug);
        const resp = await chrome.runtime.sendMessage({
          type: 'PUSH_SOLUTION',
          payload: {
            slug: s.title_slug,
            lang: s.lang,
            code: s.code,
            submittedAt: s.timestamp * 1000,
            stats: {
              runtime: s.runtime && s.runtime !== 'N/A' ? s.runtime : null,
              memory: s.memory && s.memory !== 'N/A' ? s.memory : null,
              runtimeBeats: null,
              memoryBeats: null,
            },
            meta,
            extra: {},
          },
        });
        if (resp && resp.ok && resp.skipped) skipped += 1;
        else if (resp && resp.ok) pushed += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
      report();
      await sleep(2000); // GitHub contents API throttle
    }
    report();
    backfillStatusEl.textContent += stopRequested ? ' (stopped)' : ' Done!';
  } catch (e) {
    setStatus(backfillStatusEl, `Backfill error: ${e.message}`, false);
  } finally {
    $('backfill').disabled = false;
    $('backfill-stop').disabled = true;
  }
});

$('backfill-stop').addEventListener('click', () => {
  stopRequested = true;
});

loadSettings();
