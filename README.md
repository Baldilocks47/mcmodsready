# mcmodsready

Is your Minecraft mod list ready for the new version? A static site that tracks the top Fabric and NeoForge mods on
Modrinth for every Minecraft drop, checks your own list for server / client / both, and suggests alternatives.

Spec: [minecraft-readiness-tracker-spec.md](minecraft-readiness-tracker-spec.md).

## How it fits together

```
Mojang manifest ─┐                       ┌─> R2 bucket (data/*.json) ──> Worker serves /data/*
                 ├─> GitHub Actions ─────┤
Modrinth API v2 ─┘   (pipeline/)         └─> nightly: Astro build ──> Cloudflare Pages (static site)
        ▲
        └── Cloudflare Worker cron (every 10 min) triggers the pipeline on a new release/snapshot,
            and every 30 min for 48h after a release
```

- `src/lib/core/`: pure logic shared by pipeline and site (status, readiness, alternatives, share links). Unit-tested.
- `pipeline/`: fetches data and writes JSON shards (`build-data.ts`), checks API shape (`contract.ts`), refuses bad
  publishes (`guard.ts`).
- `src/`: Astro site with Svelte islands. Per-mod pages are pre-rendered for search; live numbers are fetched from `/data`.
- `worker/`: Cloudflare Worker for the cron, `/data/*` and the cookie-free `/go/<partner>` affiliate redirect.
- `data/alternatives.json`: hand-curated replacements (beat the algorithm; keep it small).

## Local development

```bash
npm install
npm run data        # fetch real data into public/data (about 30s first time, cached after)
npm run dev         # http://localhost:4321
npm test
```

## Going live: one-time setup

Things only you can do (accounts, payment, secrets):

1. **Domain**: register `mcmodsready.com` (Cloudflare Registrar is at-cost). Add it to Cloudflare.
2. **GitHub**: create a repo and push. In *Settings → Secrets and variables → Actions* add:
   - Secrets: `CF_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Pages: Edit), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - Variables: `MODRINTH_USER_AGENT` (e.g. `mcmodsready/1.0 (https://mcmodsready.com; contact@…)`, which Modrinth
     requires to include contact info), optionally `PUBLIC_HOST_CTA` (affiliate button text) and `PUBLIC_KOFI_URL`
3. **Cloudflare**:
   - R2 bucket `mcmodsready-data`, plus an R2 API token (gives the access key pair above)
   - Pages project `mcmodsready` (direct upload), custom domain `mcmodsready.com`
   - Web Analytics (cookieless) on the Pages project
   - KV namespace for the Worker → put its id in `worker/wrangler.toml`
4. **Worker**: edit `worker/wrangler.toml` (`GITHUB_REPO`, KV id, `AFFILIATES` once approved), then
   ```bash
   cd worker && npx wrangler secret put GITHUB_TOKEN && npx wrangler deploy
   ```
   `GITHUB_TOKEN` is a fine-grained PAT for this repo only, with *Contents: read and write* (needed for repository_dispatch).
5. Run the **data** workflow once by hand (Actions → data → Run workflow).

## Monetisation (cookie-free by design)

- Hosting affiliate: a single disclosed CTA on the list page when a server list is ready, via `/go/host`.
- Self-served sponsor slot (not built yet; add when a sponsor signs).
- Ko-fi: plain link in the footer (`PUBLIC_KOFI_URL`).

No ad networks until traffic justifies a consent banner. See spec section 15.
