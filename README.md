# mcmodsready

Is your Minecraft mod list ready for the new version? Tracks Fabric, NeoForge and Forge mods on Modrinth for every
Minecraft version (drops, older releases like 1.20.1, and snapshots), checks your own list for server / client / both,
and suggests alternatives. Live at https://mcmodsready.com.

Spec and decisions: [minecraft-readiness-tracker-spec.md](minecraft-readiness-tracker-spec.md).

## How it fits together

```
Mojang manifest ─┐
                 ├─> GitHub Actions (pipeline/) ──> R2 bucket: data/*.json (changed files only)
Modrinth API v2 ─┘        │
                          └─ nightly / new version: Astro build ──> wrangler deploy
                                                                         │
                         One Cloudflare Worker on mcmodsready.com  <─────┘
                           - static site (dist/ via ASSETS)
                           - /data/*  from R2
                           - /go/*    cookie-free affiliate redirects
                           - cron (10 min): new release/snapshot or release-day window -> triggers the pipeline
Browser ── for mods below the download threshold, looks them up live on Modrinth with the same core code
```

- **Coverage**: every mod with 10k+ downloads (~15.8k across the three loaders) is precomputed. Anything else is looked
  up live in the browser, so mixed lists of popular and obscure mods behave identically.
- **Any target**: a drop ("26.3", any patch), an exact version, an older release, or any snapshot/pre-release/RC.
- `src/lib/core/`: pure logic shared by pipeline and browser (support maps, status, targets, readiness, alternatives, share links).
- `pipeline/`: `build-data.ts` (incremental: only re-fetches mods whose Modrinth modified date changed), `contract.ts`
  (fails if API shapes change), `guard.ts` (refuses bad publishes), `stage-changed.ts` (uploads only changed files).
- `src/`: Astro + Svelte. ~5,000 most-downloaded mods get pre-rendered `/mod/<slug>` pages; the 404 page sends any other
  `/mod/<slug>` to the live `/m?p=<slug>` page.
- `worker/`: the Cloudflare Worker. Config in `wrangler.toml` at the repo root.
- `data/alternatives.json`: hand-curated replacements (beat the algorithm; keep it small).

## Data files

| File | Contents |
|---|---|
| `meta.json` | versions, drops, popular older versions, counts |
| `matrix-<loader>.json` | top 500 mods with a status per recent drop |
| `stats-<loader>.json` | top-100 readiness and update speed (day 1/7/30) |
| `feed.json` | newly ready mods |
| `m/<projectId>.json` | one mod: support map for every game version and loader, deps, alternatives |
| `v/<loader>/<version>.json` | which tracked mods have a build for one exact version (extra grid columns) |
| `pages.json` | mods with pre-rendered pages |

## Local development

```bash
npm install
npm run data        # full first run fetches ~16k version lists (~1h); later runs only fetch changes
npm run dev         # http://localhost:4321
npm test
```

For a quick local dataset: `npx tsx pipeline/build-data.ts --max-per-loader 300`.

## Production setup (done once)

1. Cloudflare: R2 bucket `mcmodsready-data`, KV namespace (id in `wrangler.toml`), domain on Cloudflare.
2. **Open Workers & Pages in the dashboard once** so Cloudflare creates the account's workers.dev subdomain; cron
   triggers can't be attached until it exists. Then `npx wrangler deploy`.
3. Worker secret: `npx wrangler secret put GITHUB_TOKEN` (fine-grained PAT, this repo only, *Contents: read and write*).
4. GitHub repository secrets: `CF_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (template **Edit Cloudflare Workers**),
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Repository variables: `MODRINTH_USER_AGENT`, `PUBLIC_KOFI_URL`,
   later `PUBLIC_HOST_CTA`.
5. Optional: enable Analytics Engine in the dashboard and uncomment the `CLICKS` binding for affiliate click counts.

The first pipeline run on a cold cache fetches up to 12,000 version lists; the next run finishes the rest.

## Monetisation (cookie-free by design)

Hosting affiliate CTA on the list page (`/go/host`, set `AFFILIATES` in `wrangler.toml` and `PUBLIC_HOST_CTA`), Ko-fi link
in the footer. No ad networks until traffic justifies a consent banner. See spec section 15.
