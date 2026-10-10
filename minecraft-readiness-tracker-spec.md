# Minecraft Readiness Tracker: product and build spec

Status: draft v1, written 8 Oct 2026. Items marked **[verify]** need checking against current official docs before launch.

## 0. One-paragraph brief

A public, visual website that shows, for every new Minecraft release, how ready the popular mods are. Users pin their own list of mods and see at a glance whether that list is ready for a chosen Minecraft version, for server, client or both, and what to swap in when a mod is missing. It must update itself every release with no manual work, run on near-zero cost static hosting, collect no personal data, and earn a little from light advertising and hosting affiliate links.

Why this niche: Minecraft moved to year-based versions in 2026 (26.1, 26.1.x, 26.2, with 26.3 in snapshot as of mid-Aug 2026) and Mojang ships smaller "drops" more often, so there are more release days when everyone asks "is my mod ready yet?". Existing tools check a list you paste or mods you already installed. I found no public, always-current readiness tracker with history. **[verify with a fresh search before launch]**

## 1. Users and jobs

- Server admin: "Can I upgrade my Fabric server to the new drop yet? What is blocking me?"
- Modpack/client player: "Which of my mods are missing for the new version?"
- Both: "What should I use instead of the mod that has not updated?"

## 2. Features

MVP
- Matrix view: rows = mods, columns = recent Minecraft drops (26.1, 26.2, ...). Cell = readiness status (see section 4).
- Loader filter: Fabric first. Phase 2: NeoForge, Forge, Quilt.
- Tracked set: top N (start at 500) mods by downloads for the loader, refreshed automatically.
- Pinned lists: pick mods (search), name the list, choose target version and loader, see a readiness ring and a "what is blocking" panel. Stored in the browser (localStorage). Shareable via a URL (list encoded in the URL fragment; no backend).
- Environment readiness: for each list show three numbers, **Server ready**, **Client ready**, **Both** (section 5).
- Suggested alternatives for any mod not ready (section 6).
- Release-day banner: when a new Minecraft version appears, show a live "N of top 100 ready" counter and a "newly ready" feed.

V1
- Import a list: paste slugs, upload a Modrinth `.mrpack`, paste a mods folder listing, or drop jar files (hash them in the browser with SHA-1 and look them up by hash; send only hashes, never files).
- History: per mod, "days from release to first compatible release" for previous drops; median lag per drop (this is the content that makes the site worth linking to).
- Dependency awareness: show required library status (for example the loader API mod) as part of readiness.
- PWA/offline, dark mode, mobile layout.

Later (optional, may be paid)
- Notifications for a pinned list (Discord webhook, email digest, RSS per list) when it becomes fully ready. Needs a minimal serverless backend (see section 11).
- Datapacks: Modrinth-hosted datapacks first. Sites outside Modrinth (for example Vanilla Tweaks) would need scraping; defer.

## 3. Data pipeline (fully automated)

Sources
1. **Mojang launcher manifest** (`version_manifest_v2.json`): detect new releases and snapshots. Cron every 30 minutes. A new release adds a new column and triggers a full refresh. **[verify URL]**
2. **Modrinth API v2** (`https://api.modrinth.com/v2`): search (facets for project type, categories/loader, versions), bulk project lookup, per-project version lists filtered by `loaders` and `game_versions`, and hash lookup. Requirements: a unique, descriptive `User-Agent` header with contact info; per-IP rate limits (read `X-Ratelimit-*` headers, token-bucket, back off on 429). Pin to **v2**; v3 exists and v2 may eventually change. CORS is open but browsers cannot set User-Agent, so use a tiny proxy for client-side lookups.
3. CurseForge: out of scope for v1 (needs an API key; some authors disable API downloads).

Per-project fields used: `slug`, `title`, `icon_url`, `downloads`, `categories`, `client_side`, `server_side` (values: required/optional/unsupported/unknown), `game_versions`, `loaders`; per version: `game_versions`, `loaders`, `version_type` (release/beta/alpha), `date_published`, `dependencies`.

Pipeline steps (GitHub Actions on a schedule, or n8n on the homelab; produce static JSON):
1. Refresh the tracked set (top N by downloads) nightly.
2. For each tracked project and each of the last K Minecraft drops, compute status (section 4) from the version list.
3. Write sharded JSON: `meta.json` (versions, last updated), `versions/<mc>.json` (status per project), `projects/<slug>.json` (details, history, alternatives).
4. Store a daily snapshot to compute history and lag statistics.
5. Build the static site and deploy. Fail the build if the data is stale or the diff looks wrong (for example more than 30% of statuses regress overnight).
6. Hook for notifications: on status change `not_ready -> ready`, emit an event (RSS/JSON feed, Discord webhook).

Release-day mode: for 48 hours after a new release, refresh the top 100 every 15 to 30 minutes within rate limits.

Version normalisation: treat patch tags as one "drop" (26.2.x). A mod is ready for a drop if any compatible build exists for any patch in that drop; show the exact patch coverage on hover. Authors sometimes pin exactly one version rather than a range, so patch-level detail matters.

Important caveat to show in the UI: data is **author-declared** on Modrinth. A mod may work but be untagged, or be tagged but broken. Label it "declared compatible", not "works".

## 4. Status semantics

For (project, loader, drop):
- **Ready**: a `release` build is declared for this drop.
- **Beta/alpha only**: only pre-release builds are declared.
- **Not yet**: the project supports earlier drops but not this one.
- **Not applicable**: the project does not support this loader.
- **Unknown**: no data or conflicting data.
- **Dropped**: no update in a configurable window and marked archived/abandoned (v1).

Accessibility: never rely on colour alone; use icons/patterns plus text.

## 5. Server / client / both readiness

Use each project's `client_side` and `server_side` flags:
- A mod "matters on the server" if `server_side` is `required` or `optional`; "matters on the client" if `client_side` is `required` or `optional`.
- A list is **Server ready** if every mod that matters on the server is Ready (optional-only mods are listed as "optional" and do not block). **Client ready** likewise. **Both** requires both.
- Mods with `unknown` flags: treat as "matters on both" and show a small warning.
- Show each blocking mod with the side(s) it blocks.

## 6. Alternatives engine

For a mod M that is not ready for drop V and loader L:
1. Candidates = projects ready for V and L, with the same `project_type`, whose `client_side`/`server_side` support is at least as good as M's.
2. Score by category overlap (Jaccard on `categories`), then by downloads (log-scaled), then by recent update recency.
3. Show the top 3 with the label "Similar category. Check features before switching." Never claim equivalence.
4. Allow a hand-curated override file `alternatives.yml` (M -> list of known replacements, with a note) that outranks the algorithm. Keep it small.
5. Cache results; recompute nightly.

## 7. UX (visual first)

- Landing: big "Is it ready?" header for the latest drop with a progress bar (top 100 ready) and a "newly ready in the last 24h" list.
- Matrix: sticky header and first column, mod icon + name, status chips, loader tabs, search, sort (by downloads, by lag), compare drops.
- List view: a ring gauge for Server / Client / Both; a ranked "blockers" list; one-click "copy shareable link".
- History: a sparkline per mod and a median-lag chart per drop.
- Mobile: single-column cards; no horizontal-scroll tables.
- Performance: static JSON, lazy-loaded shards, target Lighthouse 90+.

## 8. Stack

- Astro or SvelteKit (static output), TypeScript, small charting lib (uPlot or Chart.js). No heavy framework required.
- Hosting: Cloudflare Pages (free tier) plus an optional Cloudflare Worker for the lookup proxy and notification signups. I already use Cloudflare. Custom domain: see section 9.
- CI: GitHub Actions cron (or n8n) for the pipeline. Secrets in the CI store.
- Tests: unit tests for status mapping and the readiness maths (use captured Modrinth fixtures), contract tests that fail loudly if the API shape changes, e2e test for "pin list -> share URL -> reload", Lighthouse CI.

## 9. Legal, brand and privacy

- Do not use Mojang logos or game assets. Include a clear disclaimer in the footer: "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft." **[verify exact wording in the current Minecraft Usage Guidelines]**
- Mojang's guidelines also have a section on domain names and websites. Do not put "Minecraft" in the domain until checked. **[verify]**
- Do not sell Minecraft content, items or access to Minecraft creations. A tool site with ads/affiliate/donations does not do that, but keep any paid features independent of Minecraft assets. **[verify]**
- Modrinth: respect their API terms and attribution/linking expectations; link every mod to its Modrinth page. Check icon hotlinking is permitted, else cache icons with attribution.
- The audience skews young. No accounts, no personal data, privacy-friendly analytics only (no cookies), contextual non-personalised ads, a cookie/consent banner only if the ad network needs one. Follow the UK Children's Code principles.

## 10. Monetisation plan (evidence and options)

Findings that shape this:
- **Display ads**: ad-funded is the norm in this ecosystem. Modrinth itself runs ads and shares 100% of ad revenue from creator pages with creators, and said payouts would be small at first. Mojang's guidelines allow ad revenue from fan content/websites; they restrict selling Minecraft items or advantages. Expect low single-digit pounds per thousand page views (my assumption, **unverified**) and traffic that spikes around each release.
- **Hosting affiliate (best fit)**: Minecraft host affiliate programmes pay recurring commission (one listing shows Apex Hosting at 15% recurring **[verify]**), and review sites state they earn commission on host links. Plans start around $1.99 to $5.99 per month. Illustration (my arithmetic): 15% of a ~$6/month plan is about $0.90 per customer per month, so 50 active referrals is about $45/month. The "Server ready" view is exactly where a server admin is deciding whether to upgrade or rehost, so place a single, clearly labelled CTA there. Disclose affiliate links.
- **Donations**: feasible through Ko-fi or GitHub Sponsors (Ko-fi has charged 0% on donations; **[verify]**), and many modpack makers use them, but I found no evidence that utility tools earn much from tips. Plan for roughly £0 to £20 a month.
- **Paid tool**: I did not find evidence of successful paid-only readiness/compatibility tools in this space. Most users expect it free. The only credible paid angle is a small "supporter" tier for **notifications and API/webhook access** for server admins (an alert when their list becomes ready). Test demand with a waitlist before building it.
- **Sponsorship**: hosts and mod platforms publish weekly version-update posts and buy placement elsewhere; a flat monthly sponsor for the "Server" view is a hypothesis to test once there is traffic.

Recommended order: (1) ship free with one unobtrusive ad slot and the hosting CTA, (2) add Ko-fi link, (3) after two release cycles, review traffic and decide on the notification tier or sponsor outreach. Realistic expectation: **£5 to £40 a month**, spiky, with upside only if release-day traffic builds.

## 11. Optional backend (only for notifications)

Cloudflare Worker + KV (or D1): store email/webhook + list slugs + target version. Double opt-in, one-click unsubscribe, delete on request, no other personal data. Trigger on pipeline events. Keep this behind a feature flag; the core site stays fully static.

## 12. Maintenance runbook (goal: near zero)

- New Minecraft drop: automatic (manifest detects, pipeline adds a column).
- Modrinth API change/v3: pipeline contract tests fail; pinned to v2; watch their changelog.
- Rate limiting or blocking: reduce cadence, ensure User-Agent is correct, contact Modrinth.
- Stale data: the site shows "last updated" and a banner if older than 24 hours.
- Dead mods: auto-mark "Dropped" after a configurable idle period.

## 13. Acceptance criteria

1. After a new drop appears in the Mojang manifest, the site shows it within 1 hour with no manual step.
2. Pinning a 20-mod list, choosing a drop and loader, shows correct Server/Client/Both readiness against fixtures.
3. A not-ready mod shows up to 3 sensible alternatives, honouring side support.
4. Share link round-trips (open on a clean browser, same result).
5. No cookies set, no personal data sent, Lighthouse performance 90+ on mobile.
6. Statuses are always labelled as author-declared.

## 14. Questions to ask me first

Domain name; Fabric-only for launch or add NeoForge now; how many mods to track (500?); GitHub Actions vs homelab n8n for the pipeline; ad network choice; whether to include the notification tier in v1.

## 15. Decisions (9 Oct 2026)

Answers to section 14, and changes found while building:

- **Domain**: `mcmodsready.com` (being bought). `modready.com/.gg` is a Minecraft server host, so avoid "modready" naming confusion. `modlag.com` tracks *loader* readiness across games (not per mod, no lists); closest neighbour, not a direct competitor.
- **Loaders**: Fabric + NeoForge at launch. Top 500 per loader (~590 unique projects).
- **Pipeline**: GitHub Actions, triggered by a **Cloudflare Worker cron** (Actions' own schedule is too unreliable for the 1-hour criterion). Worker also does release-day mode (dispatch every 30 min for 48h).
- **Data decoupled from deploys**: pipeline publishes JSON to **R2**, served by the Worker at `/data/*`. The site rebuilds **nightly** (and on a new release/snapshot) only so pre-rendered per-mod pages stay fresh for search. Keeps Pages well inside its free build limit.
- **Per-mod SEO pages**: `/mod/<slug>`, "Is X updated for Minecraft 26.x?". Expected to be the main traffic source.
- **History backfilled**: lag stats are computed from version publish dates, so history exists from day one. Headline metric is "% of top 100 ready by day 1/7/30", not median lag (median hides mods that never updated). First numbers, 26.3 Fabric: 42% day 1, 61% day 7, 75% day 30.
- **Environment**: Modrinth v2 now returns an `environment` field (`client_only`, `client_or_server_prefers_both`, …); prefer it over `client_side`/`server_side`. Many mods (Fabric API, JEI, Simple Voice Chat) are "optional on both sides"; these **count on both sides** (they're in your list, so you run them) and are flagged as optional, rather than never blocking (amends section 5).
- **Upcoming drop column**: 26.4 shown with a "Snapshot build" status; "not yet" shown neutrally as "Waiting".
- **Alternatives**: category overlap alone gave nonsense (owo-lib → Fabric API). Now: TF-IDF description similarity + IDF-weighted categories, minimum similarity threshold, no alternatives for or to libraries, and a curated entry suppresses guesses. Curated file is `data/alternatives.json` (JSON, not YAML).
- **Notifications tier**: not in v1; waitlist only (Phase 5).

### Monetisation (cookie-free)

1. Hosting affiliate: one disclosed CTA on the list page when a server list is ready, via the Worker's `/go/<partner>` redirect (anonymous click counts, no cookies, `rel="sponsored"`).
2. Self-served sponsor slot: static image from our domain, no third-party scripts; report impressions/clicks from Worker counts. Natural vehicle: the per-drop adoption report.
3. Ko-fi: plain link, not the widget.

No consent banner needed. Revisit ad networks at ~20–30k page views/month. Analytics: Cloudflare Web Analytics (cookieless).

### Roll-out and adoption plan for 26.4

26.4 snapshots began 22 Sep 2026; 26.3 had 12 weeks from snapshot 1 to release, so 26.4 is expected around **mid-December 2026** (unconfirmed). Plan is keyed to signals, not dates.

| Stage | When | What |
|---|---|---|
| 1. Build | now → mid-Nov | MVP (done in first pass: pipeline, matrix, list, per-mod pages); infra setup; affiliate + Ko-fi applications |
| 2. Soft launch | mid-Nov, on the 26.3 tail | Go live quietly; run unattended ≥2 weeks incl. a 26.3.x patch; data post "How long did the top 100 take to update to 26.3?" to r/fabricmc, r/feedthebeast, r/admincraft |
| 3. Run-up | 26.4 pre-releases / RCs | Badge outreach to top-50 authors; pitch hosting partner; tell MC news creators about the live counter |
| 4. Release day | T+0 → T+7d | Release-day mode (automatic); posts at T+0, T+24h, T+7d |
| 5. Afterwards | T+2–4 weeks | "26.4 adoption report"; review metrics; decide notifications tier / sponsor outreach |

Metrics (all cookie-free): Cloudflare page views + referrers, `/go/` clicks, badge requests, Search Console impressions. Starting goal for the 26.4 cycle: 5k+ visits in release week, 10+ authors using badges.

### Update (9 Oct 2026, later): coverage, Forge, exact versions, hosting

- **Hosting**: one Cloudflare Worker with static assets serves the whole site plus `/data/*` (R2), `/go/*` and the cron. No Pages project (wrangler now steers Pages projects to Workers anyway). Live at https://mcmodsready.com.
- **Loaders**: Fabric, NeoForge **and Forge** (needed for older-version users: 1.20.1 is mostly Forge).
- **Coverage**: every mod with **10k+ downloads** precomputed (15,771 mods: Fabric 11,157 / NeoForge 8,622 / Forge 10,005, with overlap). Everything else is looked up **live in the browser** from Modrinth using the same core code, so mixed lists are seamless. Live lookups come from users' own connections, so they don't share the Worker's IP rate limits.
- **Exact versions**: lists and grid columns can target a drop, any exact release (incl. 1.20.1, 1.21.1), or any snapshot/pre-release/RC with data. New status **"No build"** for older versions (instead of "Not yet").
- **Data model**: per-mod support map (game version -> best build type + first release day), per-version shards for grid columns. Incremental pipeline keyed on Modrinth's modified date (~1h cold, minutes warm); only changed files are uploaded to R2 (R2 bills per write).
- **Alternatives**: added declared-incompatibility ("rivals") signal and an inverted-index neighbour search that scales to ~15k mods. Next: semantic embeddings, port/fork detection, user feedback, eval set.
- **Pre-rendered pages**: top 5,000 mods (Workers static asset limit ~20k files); other `/mod/<slug>` URLs fall through the 404 page to the live `/m` page.

### Status at 10 Oct 2026

Live at https://mcmodsready.com with full automation: the Worker cron (every 10 min) triggers the GitHub `data` workflow, which refreshes ~15.8k mods incrementally, publishes changed files to R2 and (nightly / on a new version) rebuilds and deploys. Sitemap (5,004 URLs) and robots.txt live. Cloudflare Web Analytics (cookieless) enabled.

### Close-out checklist (finish before the next phase)

- [ ] Search Console: Domain property for mcmodsready.com, sitemap `https://mcmodsready.com/sitemap-index.xml` submitted
- [ ] Email: Cloudflare Email Routing (free, receive-only) for `hello@` and `affiliates@`. addy.io Lite slot kept for the other project; upgrade to the multi-domain tier only when this site needs to send (sponsor outreach)
- [x] Git history: AI co-author trailers removed and author email set to hello@mcmodsready.com (`.git/rewrite-history.sh`, run by the owner; force-pushes main)
- [ ] Add hello@mcmodsready.com to the GitHub account so commits link to it
- [ ] Apex Hosting affiliate application from affiliates@; on approval, set `AFFILIATES` in `wrangler.toml` and `PUBLIC_HOST_CTA`
- [x] Cloudflare Web Analytics
- [x] Minecraft-flavoured restyle (original pixel look, no Mojang assets)
- [x] Worker cron attached, `GITHUB_TOKEN` Worker secret set, `CLOUDFLARE_API_TOKEN` upgraded to Workers edit

### Next phase (agreed order, toward the mid-November soft launch)

1. **"Ready for 26.x" badges** for mod authors (Worker-rendered SVG): backlinks are the main growth lever.
2. **Social preview (OG) images** per drop and per mod page, so shared links look good on Reddit/Discord.
3. **26.3 adoption report page**: day-1/7/30 readiness by loader, plus the Forge finding (15 of the top 100 Forge mods ready for 26.3 vs 75 Fabric / 68 NeoForge). Doubles as the soft-launch post.
4. **Import**: `.mrpack` upload and dropping a mods folder's jars (SHA-1 hashed in the browser, looked up by hash; files never uploaded).
5. **Alternatives v2**: semantic embeddings over full project bodies, port/fork detection, then a small eval set in CI.
6. **Quality gates**: e2e test (pin list → share → reload) and Lighthouse CI.

Then rollout stage 3 (badge outreach, hosting partner pitch) and 26.4 release-day prep.

### Backlog (later)

PWA/offline; notifications tier (waitlist first); self-served sponsor slot; ad networks once traffic justifies a consent banner.
