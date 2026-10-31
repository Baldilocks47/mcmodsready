# Build designs: what's next

Pick-up notes for future work. Each item says why it matters, how to build it against the current code, what to test, and when it's done. Product decisions and history live in [the spec](../minecraft-readiness-tracker-spec.md) (section 15); architecture and data files are in the [README](../README.md).

Written 31 Oct 2026. Items marked **[verify]** rest on assumptions to check first.

## Order

| # | Item | Size | Do it |
|---|---|---|---|
| 1 | [26.4 release readiness](#1-264-release-readiness) | S | Before 26.4 pre-releases (expected ~late Nov; release estimated mid-Dec, unconfirmed) |
| 2 | [Quality gates](#2-quality-gates) | S–M | Before 26.4; catches the class of bug that hid the mod pages from Google |
| 3 | [Import: modpack and jars](#3-import-modpack-and-jars) | M | When real users ask, or after the first posts |
| 4 | [Alternatives v2](#4-alternatives-v2) | L | After Modrinth replies (see the AI clause below) |
| 5 | [Self-hosted icons](#5-self-hosted-icons-conditional) | S | Only if Modrinth asks |
| 6 | [Later ideas](#6-later-ideas) | – | When traffic justifies them |

## Constraints that apply to everything

- **Mojang usage guidelines** (read in full, 31 Oct 2026): no Mojang brand elements (logos, fonts, textures, "distinctive characteristics") in our branding; "Minecraft" never the lead words of a title; the disclaimer on the site and related materials; no impression of being official; the domain must not be run "principally to make money, including through affiliate services", so monetisation stays secondary to the tool. Mojang won't advise on individual projects.
- **Modrinth terms** (last modified 13 Aug 2026): the API licence covers downloading, displaying and querying content via our own site. Open points are in the email drafted for them: "personal, non-commercial use", no "robot, spider" access, no "in-line linking", and **no using its data to "train, develop, or improve" AI or machine-learning models**.
- **Cookie-free, no accounts, no personal data.** Anything that breaks this needs a deliberate decision.
- **Never mention AI tooling in commits, PRs or pushed files.** Local hooks enforce this; they aren't versioned, so re-create them on a new clone.
- **Deploy locally only via `npm run deploy`.** Prefer letting the nightly workflow deploy.

---

## 1. 26.4 release readiness

**Why:** release day is the site's biggest traffic moment and the first live run of release-day mode. The cron decisions are unit-tested (`tests/worker.test.ts`), but the end-to-end path has never run on a real release.

### Known gaps to fix first

1. **Old report pages will vanish.** `/report/[drop]` and `reportFor` only know `meta.drops`, the 4-drop window. When 26.4 ships and 26.5 snapshots begin, 26.1 falls out and `/report/26.1` returns 404, losing any links to it.
   - Fix: add every released year-based drop to `meta.json` (`allDrops`), publish `matrix`-independent per-drop cells or a `report-<drop>.json` frozen snapshot, and generate pages from that.
   - Freezing matters: the top 100 is re-ranked daily, so a report's "now" numbers drift. Decide whether old reports stay live or freeze at, say, day 90.
2. **Scheduled workflows stop after 60 days without repo activity** (GitHub's rule for public repos **[verify current wording]**). If the repo goes quiet, nightly refreshes silently stop.
   - Fix: have the Worker cron dispatch `refresh-data` with `rebuild: true` once a day if the last dispatch is over 26h old, using the `STATE` KV entry. This also removes the dependence on GitHub's late-running schedule.
3. **Nothing alerts anyone if automation fails.** The stale banner only tells visitors.
   - Fix: GitHub emails on workflow failure by default **[verify setting]**; add a Worker check that emails or calls a webhook if `meta.generatedAt` is over 36h old.
4. **Token expiry:** the GitHub token and the analytics token last one year (Oct 2027). Keep the reminders.

### Dry run (a week before pre-releases)

Trigger the path by hand: delete the `manifest` key in `STATE` KV to fire `init`, then watch the workflow complete, R2 update, the site rebuild, and the stale banner stay off. Time it. A warm run must finish well inside the 30-minute refresh interval.

### Rollout (see the spec's plan)

- **Pre-release:** badge outreach to about 10 authors; send the live counter to Minecraft news writers and modding YouTubers.
- **T+0:** check the 26.4 column appears within the hour (acceptance criterion 1). Post the counter.
- **T+24h, T+7d:** status posts. **T+2–4 weeks:** adoption report post.

**Done when:** the dry run passes, gaps 1–3 are closed, and `/report/26.1` survives a simulated window shift.

---

## 2. Quality gates

**Why:** three shipped bugs were invisible to the unit tests: the robots.txt prefix block, `.html` canonicals, and stale data overwriting a fresh build. Add checks on the *built output* and the *live site*.

### Build-output checks (cheap, do first)

New `tests/build-output.test.ts`, run in CI after building against fixtures:
- `robots.txt`: every sitemap URL is allowed. Use a real prefix-matching check, so `Disallow: /m` fails.
- Canonicals: every sampled page's canonical has no `.html` and matches the sitemap entry.
- Every sitemap URL maps to a built file; no `/m` or `/404` in the sitemap.
- Every mod page has at least one crawlable link to another mod; `/browse/1` links to mods.
- Disclaimer text is on every sampled page; titles don't begin with "Minecraft".

### End-to-end (Playwright)

Serve `dist` with fixture data copied to `/data`. Stub `api.modrinth.com` with `page.route` so tests are hermetic. Cover:
- paste a list → rings and verdicts → copy link → open in a clean context → same result (acceptance criteria 2 and 4);
- target switch to 1.20.1 on Forge; an untracked mod via the stubbed live lookup;
- `/mod/<unknown>` → 404 → `/m?p=` (needs `not_found_handling`, so run against `wrangler dev` or test the script alone);
- no cookies set (criterion 5).

### Lighthouse CI

Against `/`, `/mods`, `/list`, `/mod/sodium`, `/report/<drop>`, mobile profile. The target is performance 90+ (criterion 5), **which has never been measured**. Likely suspects if it falls short: 70 KB `meta.json` embedded in `/mods` and `/list` as island props (send a trimmed version list), and loading `meta.json` on every page for the "updated" time (use a tiny `status.json`).

### Post-deploy smoke test

A final workflow step: fetch key routes, assert 200s, the correct `generatedAt`, a badge returning SVG, `/go/host` returning 302.

**Done when:** all of the above run in CI and each of the three historic bugs, reintroduced, fails a check.

---

## 3. Import: modpack and jars

**Why:** typing 150 mods is the biggest barrier for pack makers and server admins, the site's best users.

### User experience

A drop zone in the list checker's setup panel, beside "Paste a list": drop a `.mrpack` or a mods folder's `.jar` files (also a file picker). Show a result summary: "Found 142 of 150. Not on Modrinth: x.jar, y.jar". The message must say files stay in the browser.

### How it works

New pure module `src/lib/core/import.ts`, plus browser glue in `src/lib/ui/data.ts`.

**`.mrpack`** (a zip):
1. Unzip in the browser with `fflate` (small; lazy-import so normal page weight is unaffected).
2. Read `modrinth.index.json`: `files[].hashes.sha1`, `files[].path`, `dependencies` (`minecraft`, `fabric-loader`, `neoforge`, `forge`).
3. Keep only `mods/*.jar` paths. Set the list's loader from `dependencies`. Name the list after the pack's `name`.
4. Offer the pack's Minecraft version as "currently on", and keep the target on the latest drop: "going from 1.21.1 to 26.3" is the question being asked.
5. Files in `overrides/mods/` have no hash in the index: hash them after unzipping.

**Jars:**
1. SHA-1 each with `crypto.subtle.digest`. This is why the spec promises files aren't uploaded.
2. On a miss, read `fabric.mod.json` or `META-INF/neoforge.mods.toml` / `mods.toml` from inside the jar for the mod's id and name, then fall back to `resolveNames`. Flag these as "matched by name", because they can be wrong.

**Lookup:** `POST https://api.modrinth.com/v2/version_files` with `{ hashes, algorithm: "sha1" }` returns hash → version, including `project_id` **[verify shape and batch limit]**. CORS is open, so no Worker proxy is needed, which simplifies the spec's plan. Batch at 500. Add the resulting ids to the list.

**Limits:** cap at 1,000 files; read jars sequentially to avoid memory spikes; show progress.

### Privacy

Only hashes go to Modrinth; update the About page to say so. Add nothing to analytics.

### Tests

Fixture `.mrpack` built in the test; unit tests for index parsing, filtering, loader detection, TOML/JSON fallback; e2e with a stubbed `version_files`.

**Done when:** a real 100+ mod pack imports in under about 5 seconds with correct loader and clear reporting of misses.

---

## 4. Alternatives v2

**Why:** today's matching (TF-IDF on one-line descriptions, IDF-weighted categories, declared rivals, curated list) gets good hits but also weak ones (ModelFix → model-browser). A bad suggestion costs more trust than no suggestion.

**Gate:** Modrinth's terms ban using its data to "train, develop, or improve" AI/ML models. Running an already-trained open model to compare text is arguably not that, but **don't build step 3 until Modrinth has answered**. Never train or fine-tune on Modrinth data. Steps 1, 2 and 4 don't depend on the answer.

### Steps, each shippable alone

1. **Evaluation first.** `data/alternatives-gold.json`: 50–100 hand-checked pairs, both good ("EBE → EBE Reloaded") and bad ("ModelFix ↛ model-browser"). `tests/alternatives-eval` computes precision@3 over a frozen fixture and fails CI on regressions. Record today's score as the baseline. No other step ships unless this improves.
2. **Ports and forks** (highest value, no ML).
   - Normalise titles: lowercase, strip loader words and brackets. Same stem and overlapping author or source repo = a port; "X Reloaded", "X Fork", "X Continued" = a successor.
   - GitHub forks: parse `source_url` from project data (needs storing), and query `repos/{owner}/{repo}` for `parent`. Use a token and cache forever per repo.
   - Add `reason: 'curated' | 'port' | 'fork' | 'rival' | 'similar'` to `AltRef`, and say why in the UI ("Fork of X"). Rank above similarity.
3. **Meaning-based matching** (gated).
   - Text: title, description and the first ~2,000 characters of the project `body` with markdown stripped. `/projects?ids=` returns `body` **[verify]**. Store only a hash and the vector, not the text.
   - Model: a small open sentence-embedding model (e.g. all-MiniLM-L6-v2) via transformers.js, CPU in Actions. Estimate about 30 ms per mod, so roughly 8 minutes cold and seconds incrementally **[measure]**.
   - Cache vectors in `.cache/vectors/`, keyed by text hash. Keep the model cached between runs.
   - Replace `SimilarityIndex.text` behind the same interface so the rest of `alternativesFor` is unchanged. Brute-force cosine over ~10k vectors per loader is fine in a nightly job.
4. **Votes** (later; needs traffic): anonymous thumbs on a suggestion, stored in Workers D1 by pair only, no IP. Feed into ranking and the gold set.

**Also:** modpack co-occurrence (mods rarely installed together are likelier substitutes) needs downloading thousands of manifests, which sits badly with the "no robot" clause. Skip unless Modrinth is happy.

**Done when:** precision@3 beats the baseline by an agreed margin and each suggestion states its reason.

---

## 5. Self-hosted icons (conditional)

**Why:** mod icons load directly from `cdn.modrinth.com`, and the terms prohibit displaying the Service by "in-line linking". The API licence allows downloading and displaying content and returns these URLs, so the practice looks defensible and is common, but it isn't explicitly cleared. Build this if Modrinth asks.

**Design:** in the pipeline, fetch the 96px icon once per `icon_url` change, store it in R2 under `data/i/<id>.webp` (uploaded only when changed, about 16k small files), and rewrite `icon` in `ModFile`/`MatrixMod`. Live lookups keep Modrinth's URL or show a placeholder. Serve via the Worker with a long cache. Allow `.webp` in the `/data` path check.

---

## 6. Later ideas

- **More search value per page:** Google may not index 5,000 similar pages. Add unique, useful content: a fuller update history per mod (easy to derive from `dropCell`), required libraries, and links to mods that depend on it. Decide with Search Console data; consider fewer pages if quality signals are poor.
- **Accurate per-page analytics:** the current sampling is too coarse. Revisit once traffic grows, or log page paths through Analytics Engine from the Worker (this needs the Worker in front of HTML routes).
- **Notifications** (Discord webhook, email, RSS per list): needs a backend and personal data handling. Waitlist first. Only credible paid tier.
- **Self-served sponsor slot:** static image from our domain on the report page; no third-party scripts. Sponsors must be suitable for all ages under Mojang's rules.
- **Ad networks:** revisit at about 20–30k page views a month; needs a consent banner and Children's Code review.
- **PWA/offline, datapacks, CurseForge** (needs an API key; some authors disable API access).
