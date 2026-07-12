# Grindlog — Launch Plan, Roadmap & Maintenance Playbook

The single source of truth for shipping, growing, and maintaining Grindlog.
Strategy: **submit v1.0 exactly as-is now; build v1.1 (stats card) during the review
window; ship it the day 1.0 is approved.**

---

## Phase 0 — Before submission (do now, ~1 day)

### Repo hygiene
- [ ] `git init`, first commit, push to a public GitHub repo named `grindlog`
      (claim the name even if you keep code private at first — but public is better:
      "open source" is a trust signal for an extension that handles a GitHub token).
- [ ] Add an MIT `LICENSE` file (expected for dev tools; enables contributions).
- [ ] Rename the local folder `PushLeetcode` → `grindlog` (re-point the unpacked
      extension in `chrome://extensions` afterwards).

### Hosting (needed for the store listing)
- [ ] GitHub Pages: Settings → Pages → deploy `site/` (move `site/*` to `/docs` or
      use a `gh-pages` branch — Pages only serves `/`, `/docs`, or a branch root).
- [ ] Verify `https://<you>.github.io/grindlog/` and `/privacy.html` load.
- [ ] Replace `GITHUB_REPO_PLACEHOLDER` in `site/index.html` + `site/privacy.html`.
      (`INSTALL_URL_PLACEHOLDER` waits until the store URL exists.)

### Final smoke test (15 min, use a throwaway test repo)
- [ ] Fresh install → onboarding opens → connect → solve an easy problem →
      toast + 4 commits appear (solution, problem README, index.json, root README).
- [ ] Resubmit different code → second file, first untouched.
- [ ] Resubmit identical code → "skipped" toast, no commit.
- [ ] Backfill 5–10 items without errors.
- [ ] Check the service-worker console (`chrome://extensions` → Inspect views)
      for any red errors during all of the above.

### Store assets
- [ ] Screenshots, 1280×800 PNG (3–5): onboarding page; LeetCode page with the
      green push toast; populated repo root README (dashboard); a problem folder
      showing 2 approaches; options page with backfill.
- [ ] Small promo tile 440×280 (required): icon + "Your grind, committed." on the
      dark brand background. (Same headless-Chrome trick used for the icons works.)

---

## Phase 1 — Submission (~1 hour)

1. Developer account: https://chrome.google.com/webstore/devconsole ($5 one-time).
2. Bump `manifest.json` version to `1.0.0`.
3. Zip the **contents** of `extension/` (manifest.json at zip root, not nested).
4. Listing:
   - **Name:** Grindlog  ← never "LeetCode" in the name (trademark); fine in the
     description.
   - **Summary (132 chars max):** "Auto-commits every accepted LeetCode solution to
     your GitHub — every approach, with stats, attempts and streaks."
   - **Description:** lift from README "How it differs" section; end with the
     non-affiliation disclaimer.
   - **Category:** Developer Tools. **Language:** English.
   - **Privacy policy URL:** the GitHub Pages `/privacy.html`.
   - **Single purpose:** "Automatically commits the user's accepted LeetCode
     solutions to their own GitHub repository."
   - **Permission justifications:** `leetcode.com` = read the user's own submissions
     and public problem metadata; `api.github.com` = commit to the user's chosen
     repo with their token; `storage` = settings + retry queue; `alarms` = retry
     failed pushes.
   - **Data disclosure form:** select "does not collect user data" — truthfully.
5. Submit. Typical first review: 2–14 days (host permissions = manual review).
   Rejections come with a reason; fix and resubmit (subsequent reviews are faster).

---

## Phase 2 — During review: build v1.1, the stats card (the growth loop)

**Why this is the #1 feature:** users embed the card in their GitHub *profile*
README → every profile visit advertises Grindlog → compounding acquisition, zero
marketing spend.

### Spec
- New module `extension/lib/card-builder.js`: pure function `buildStatsCard(index)`
  → SVG string. Data already exists in `.grindlog/index.json`.
- Content: solved count ring (Easy/Medium/Hard arcs), daily streak 🔥, top-5 topics
  bar, avg attempts, "powered by Grindlog" footer link (the loop).
- Design: match brand (#14171c bg, #2cbb5d green, #ff9a2a flame). Two variants via
  a settings toggle later; ship dark-only first. Pure SVG text — no fonts to embed
  beyond system stack, no external images (GitHub READMEs strip remote scripts;
  static SVG in-repo renders fine).
- background.js: after the root-README step, `upsertFile('grindlog-card.svg', …)`
  — one extra API call per push.
- Root README gains: "Add this to your profile README:" + the copy-paste
  `![Grindlog stats](https://raw.githubusercontent.com/<owner>/<repo>/main/grindlog-card.svg)` snippet.
- Test: render sample SVG via headless Chrome screenshot; eyeball at README width.

Ship as 1.1.0 immediately after 1.0 approval (updates review in ~hours-days).

---

## Phase 3 — Launch week (after approval)

- [ ] Replace `INSTALL_URL_PLACEHOLDER` on the landing page with the store URL.
- [ ] Add the store badge + landing link to the repo README.
- Announce (each wants slightly different framing):
  - **r/leetcode** — frame as "I built a tool that keeps *every* approach and tracks
    attempts/solve-time" (the community's pain with LeetHub overwrites is known).
    Show the repo screenshot, not the extension.
  - **Show HN** — "Show HN: Grindlog – LeetCode submissions to GitHub, keeping every
    approach". Lead with the honest "LeetHub exists; here's what it doesn't do" story.
  - **X/Twitter + LinkedIn** — the stats-card image IS the post.
  - **dev.to / Hashnode** — write the build story ("How I built a MV3 extension that
    intercepts LeetCode's fetch calls") — devs share build stories more than launches.
- [ ] Ask the first 10 users for a Web Store review — early reviews dominate ranking.

### Metrics (no analytics by design — use what's free)
- Chrome Web Store dashboard: installs, uninstall rate, impressions.
- GitHub: stars, issues, traffic on the repo.
- Search "grindlog-card.svg" on GitHub occasionally: literal count of embedded cards.

---

## Roadmap after v1.1 (priority order, with effort)

| Ver | Feature | Spec sketch | Effort |
|-----|---------|-------------|--------|
| 1.2 | **Approach naming + notes** | After accepted toast, inline input (15s timeout, skippable): approach name + optional complexity ("O(n) time / O(1) space"). Goes into filename (`…_21ms_two-pointers.java`), header, README table. Push proceeds immediately on skip/timeout — never block the push. | ~1 day |
| 1.3 | **Revisit queue (spaced repetition)** | Flag problems with ≥3 failed attempts or >45 min. Popup section: "Due for review" at 14/30/60-day intervals (data already in index.json + storage.local). Click → opens problem. | ~1–2 days |
| 1.4 | **Streak guard** | `chrome.notifications` + daily alarm at user-set hour: if today's Daily Challenge slug isn't in index.json, nudge. Off by default; toggle in options. Needs `notifications` permission → store re-review, so batch with another feature. | ~0.5 day |
| 1.5 | **Weekly recap** | Sunday alarm generates `recaps/2026-W28.md`: problems solved, time spent, new topics, streak. Nice email-less journaling. | ~1 day |
| 2.0 | **Multi-platform: Codeforces first** | Refactor: `platforms/leetcode.js` + `platforms/codeforces.js`, each exporting `{matches, interceptor rules, metadataFetcher}`. Manifest gains codeforces.com host permission (re-review). Then AtCoder, HackerRank. This is why the name isn't Leet-anything. | ~1 wk |
| 2.x | **Contest mode** | LeetCode contest endpoints (`/contest/api/…`) differ; capture post-contest. Research first. | ~2–3 days |

**Deliberately not doing:** accounts/backends/leaderboards (converts a
zero-maintenance tool into a service with uptime, cost, and GDPR obligations);
scraping premium company tags into repos (LeetCode ToS risk); capturing "Run"
clicks (noise); Firefox port until Chrome traction exists (MV3 differences are real).

---

## Maintenance playbook

### What will break, in likelihood order
1. **LeetCode changes the submit/check endpoints or response fields**
   *Symptom:* accepted submissions produce no toast, nothing pushes; no errors in
   the repo. *Debug:* problem page DevTools → Network tab → submit a solution →
   find the submit + check calls → compare URL/fields against `interceptor.js`
   (`isSubmitUrl`, `isCheckUrl`, `handleCheckResponse`). Update the matchers.
2. **LeetCode GraphQL schema drift** (question fields renamed)
   *Symptom:* toast shows "LeetCode GraphQL error: …". *Fix:* adjust the query in
   `content.js` (`fetchQuestionMeta`) and `options.js` (backfill copy of it).
3. **GitHub API changes** — least likely (REST contents API is years-stable and
   versioned via the `X-GitHub-Api-Version` header in `lib/github.js`).
4. **Chrome MV3 policy changes** — watch the Chromium extensions blog; you're using
   no deprecated APIs.

### Update/release process
1. Fix on a branch → bump `manifest.json` version (semver: fixes = patch,
   features = minor) → re-run the Phase-0 smoke test.
2. Zip `extension/` contents → devconsole → upload new package → submit.
   Updates auto-roll to users within ~hours of approval.
3. Tag the release on GitHub (`git tag v1.0.1`) with a one-line changelog.

### Support routine (~15 min/week)
- Enable GitHub Issues; add two templates: Bug (ask for: Chrome version, what the
  toast said, service-worker console errors) and Feature request.
- Watch Web Store reviews (devconsole) — reply to every one, especially negatives;
  responses are public and visible to prospective installers.
- Common user issues to expect: expired PAT ("Bad credentials" → toast + queue;
  answer: new token in settings), token scoped to wrong repo, repo with zero
  commits (contents API 409s on empty repos — onboarding says initialize with
  README for this reason).

### Recurring checks
- Monthly: solve one problem with the extension on (canary test).
- On any Chrome major release: quick smoke test.
- Keep a pinned issue "Status: working as of <date>" — users of LeetHub-type tools
  check this first when LeetCode redesigns.

---

## Positioning cheat-sheet (for every announcement, listing, reply)

One-liner: **"Grindlog auto-commits every accepted LeetCode solution to your
GitHub — every approach, never overwritten, with the stats that tell you what to
revise."**

vs LeetHub/LeetSync (say it plainly, it builds trust): they push your latest
accepted code; Grindlog keeps the whole journey — multiple approaches, failed-attempt
counts, solve time, streaks, and a dashboard README — with no server in the middle.

Always include: not affiliated with LeetCode; open source; token never leaves the
browser except to api.github.com.
