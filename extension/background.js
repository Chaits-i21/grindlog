// MV3 service worker. Receives accepted-submission payloads from content.js (or the
// options-page backfill), formats files, and pushes them to GitHub. Failed pushes go
// to a retry queue in chrome.storage.local, retried on an alarm.

import {
  buildSolutionFile, buildProblemReadme, buildFilename, folderName, sha256Hex,
} from './lib/format.js';
import { GitHub } from './lib/github.js';
import { buildRootReadme } from './lib/index-builder.js';

const INDEX_PATH = '.grindlog/index.json';
const RETRY_ALARM = 'grindlog-retry';

async function getConfig() {
  const cfg = await chrome.storage.sync.get(['token', 'owner', 'repo', 'branch']);
  if (!cfg.token || !cfg.owner || !cfg.repo) return null;
  return { branch: 'main', ...cfg };
}

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* badge is cosmetic */ }
}

// ---- core push ----

async function pushToGitHub(payload, config) {
  const gh = new GitHub(config);
  const { meta, stats = {}, extra = {} } = payload;
  const problemKey = folderName(meta.frontendId, meta.slug);

  // Central index doubles as the dedupe database (code hashes per problem).
  const indexFile = await gh.getFile(INDEX_PATH);
  const index = indexFile ? JSON.parse(indexFile.text) : { problems: {} };

  const codeHash = await sha256Hex(payload.code.trim());
  const entry = index.problems[problemKey] || {
    frontendId: meta.frontendId,
    title: meta.title,
    slug: meta.slug,
    difficulty: meta.difficulty,
    topics: meta.topics,
    solutions: [],
  };

  if (entry.solutions.some((s) => s.hash === codeHash)) {
    return { ok: true, skipped: true };
  }

  const filename = buildFilename(payload.submittedAt, stats.runtime, payload.lang);
  const fileContent = buildSolutionFile(payload);
  const commitTitle = `${meta.frontendId}. ${meta.title}`;

  // 1. Solution file — new path every time, never overwritten.
  await gh.putFile(
    `${problemKey}/${filename}`,
    fileContent,
    `Add solution: ${commitTitle}${stats.runtime ? ` (${stats.runtime})` : ''}`
  );

  entry.solutions.push({
    file: filename,
    lang: payload.lang,
    runtime: stats.runtime || null,
    memory: stats.memory || null,
    runtimeBeats: stats.runtimeBeats ?? null,
    memoryBeats: stats.memoryBeats ?? null,
    hash: codeHash,
    submittedAt: payload.submittedAt,
    dailyDate: extra.dailyDate || null,
    failedAttempts: extra.failedAttempts ?? null,
    minutes: extra.minutes ?? null,
  });
  index.problems[problemKey] = entry;

  // 2. Per-problem README.
  await gh.upsertFile(
    `${problemKey}/README.md`,
    buildProblemReadme(meta, entry.solutions),
    `Update README: ${commitTitle}`
  );

  // 3. Central index (re-fetch sha — upsert handles create vs update).
  await gh.upsertFile(INDEX_PATH, JSON.stringify(index, null, 2), `Update index: ${commitTitle}`);

  // 4. Root README dashboard.
  await gh.upsertFile('README.md', buildRootReadme(index), `Update index: ${commitTitle}`);

  return {
    ok: true,
    file: `${problemKey}/${filename}`,
    url: `https://github.com/${config.owner}/${config.repo}/blob/${config.branch}/${problemKey}/${filename}`,
  };
}

// ---- retry queue ----

async function getQueue() {
  const { queue } = await chrome.storage.local.get('queue');
  return queue || [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ queue });
  await setBadge(queue.length ? String(queue.length) : '', '#ef4743');
  if (queue.length) {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });
  } else {
    chrome.alarms.clear(RETRY_ALARM);
  }
}

async function enqueue(payload) {
  const queue = await getQueue();
  queue.push({ payload, queuedAt: Date.now() });
  await setQueue(queue);
}

async function processQueue() {
  const config = await getConfig();
  if (!config) return;
  let queue = await getQueue();
  const remaining = [];
  for (const item of queue) {
    try {
      const result = await pushToGitHub(item.payload, config);
      await recordLastPush(result, item.payload);
    } catch {
      remaining.push(item); // still failing — keep for next alarm
    }
  }
  await setQueue(remaining);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) processQueue();
});

// ---- bookkeeping for the popup ----

async function recordLastPush(result, payload) {
  await chrome.storage.local.set({
    lastPush: {
      at: Date.now(),
      title: `${payload.meta.frontendId}. ${payload.meta.title}`,
      ok: result.ok,
      skipped: !!result.skipped,
      file: result.file || null,
      url: result.url || null,
    },
  });
}

// ---- message handling ----

async function handlePush(payload) {
  const config = await getConfig();
  if (!config) {
    return { ok: false, error: 'Not configured — open the extension options and add your GitHub token/repo.' };
  }
  try {
    const result = await pushToGitHub(payload, config);
    await recordLastPush(result, payload);
    // Retry anything that queued up earlier while we know GitHub is reachable.
    processQueue();
    return result;
  } catch (e) {
    await enqueue(payload);
    return { ok: false, queued: true, error: e.message };
  }
}

async function handleTestConnection() {
  const config = await getConfig();
  if (!config) return { ok: false, error: 'Missing token, owner, or repo.' };
  try {
    const info = await new GitHub(config).repoInfo();
    return { ok: true, repo: info.full_name, private: info.private };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'PUSH_SOLUTION') {
    handlePush(msg.payload).then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'TEST_CONNECTION') {
    handleTestConnection().then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_QUEUE_COUNT') {
    getQueue().then((q) => sendResponse({ count: q.length }));
    return true;
  }
  return false;
});

// First install → open the onboarding page.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// Restore badge state when the worker wakes up.
getQueue().then((q) => setBadge(q.length ? String(q.length) : '', '#ef4743'));
