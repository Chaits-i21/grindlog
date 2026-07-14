# Grindlog

A Chrome extension (Manifest V3) that automatically pushes every **Accepted** LeetCode
submission to a GitHub repository — with the problem statement, difficulty, topics, and
hints included — while keeping **every** approach you submit, never overwriting old ones.

Your local copy is simply a clone of the output repo: `git pull` after solving.

## How it differs from LeetHub / LeetSync

Tools like LeetHub v3 already push accepted solutions to GitHub. Grindlog exists because:

- **Every approach is kept.** Resubmitting a problem adds a new timestamped file
  (`2026-07-12_132705_21ms.java`) instead of overwriting — brute force and optimized
  versions live side by side with their runtime/memory stats.
- **Rich metadata.** Each solution file gets a comment header (difficulty, topics,
  runtime/memory + beats %, attempts, solve time, daily-challenge tag), and each problem
  folder gets a README with the full statement and hints.
- **Auto-generated dashboard.** The repo's root README shows solved counts by
  difficulty, a problem index, per-topic groupings, your daily-challenge streak, and
  average submissions-to-accept.
- **Backfill.** A one-click import pulls your entire past accepted-submission history
  into the repo.
- **Attempt tracking.** Failed submissions are counted (code discarded), so the header
  can say `Solved in 24 min after 2 failed attempts`.
- **Retry queue.** Pushes that fail (offline, bad token) are queued and retried
  automatically every 5 minutes; the extension badge shows the pending count.

## Setup

1. **Create the output repo** on GitHub (e.g. `leetcode-solutions`, private or public),
   initialized with any file (a repo with at least one commit).
2. **Create a fine-grained Personal Access Token**: GitHub → Settings → Developer
   settings → Fine-grained tokens. Scope it to **only** that repo, permission
   **Contents: Read and write**.
3. **Load the extension**: Chrome → `chrome://extensions` → enable *Developer mode* →
   *Load unpacked* → select the `extension/` folder.
4. **Configure**: click the extension icon → *Open settings* → paste token, owner,
   repo, branch → *Save* → *Test connection*.
5. Solve a problem on leetcode.com and hit **Submit**. On *Accepted*, a green toast
   confirms the push.
6. (Optional) **Import past submissions** from the settings page to backfill your
   history. Keep the tab open; it's throttled to ~2s per solution.

## Repo layout it produces

```
README.md                          ← auto-generated dashboard + index
.grindlog/index.json           ← metadata + dedupe database (don't edit)
3121-count-the-number-of-special-characters-ii/
  README.md                        ← statement, hints, table of approaches
  2026-07-12_132705_21ms.java
  2026-07-13_091200_5ms.java       ← second approach, first one untouched
```

## Architecture

```
interceptor.js (page world)  — wraps fetch/XHR; captures the code sent to /submit/
                               and the verdict polled from /submissions/detail/{id}/check/
content.js (isolated world)  — fetches problem metadata from LeetCode GraphQL, tracks
                               attempts + solve time, shows toasts
background.js (service worker) — formats files, pushes via GitHub contents API,
                               maintains index.json + READMEs, retry queue
options.html/js              — settings (PAT, repo) + backfill import
popup.html/js                — status: config, last push, retry queue
onboarding.html/js           — opens on install; guided setup with embedded config + test
icons/                       — extension icons (16/32/48/128)
```

`docs/` holds the public landing page and privacy policy (host on GitHub Pages —
Settings → Pages → deploy from the `docs/` folder or a `gh-pages` branch).
`store-assets/` holds the 512px icon for the Chrome Web Store listing.

Interception (not DOM scraping) is used because the submit POST body is the only
reliable source of the exact submitted code, and the check response carries the stats.
It survives LeetCode UI redesigns.

## Verification checklist

- [ ] Extension loads unpacked with no errors on `chrome://extensions`
- [ ] Test connection succeeds in settings
- [ ] Submit an accepted solution → toast appears; repo gains folder + solution + README; root README updated
- [ ] Resubmit different approach → second file added, first untouched
- [ ] Resubmit identical code → toast says duplicate skipped, no new commit
- [ ] Wrong Answer submission → nothing pushed; next accept says "after 1 failed attempt"
- [ ] Bad token → red toast, submission queued, badge shows count; fixing token + waiting 5 min (or next submit) drains queue
- [ ] Backfill on a fresh repo imports past accepted solutions oldest-first
- [ ] `git clone` + `git pull` gives you the local copy


## Notes & limits

- Contest submissions (`leetcode.com/contest/…`) are not captured — different endpoints.
- Solve time is measured from when the problem page is first opened in this browser.
- The stats dashboard's "beats %" is only available for live submissions (LeetCode's
  history API doesn't return percentiles for backfilled ones).
- Everything is client-side; your token lives in `chrome.storage.sync` and only ever
  talks to `api.github.com`.
