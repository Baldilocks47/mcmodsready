// Quick traffic report: Cloudflare Web Analytics (cookieless) + affiliate clicks and badge loads.
// Needs a read-only API token with "Account Analytics: Read", in .env.analytics (gitignored) or ~/mcmodsready/.env.analytics:
//   CF_ANALYTICS_TOKEN=...
// Usage: npm run stats [-- days]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = process.env.CF_ACCOUNT_ID ?? 'eb54895a32fd417b580e35943342f0ca';
const days = Number(process.argv[2] ?? 7);

function token(): string {
  if (process.env.CF_ANALYTICS_TOKEN) return process.env.CF_ANALYTICS_TOKEN;
  // project folder first, then a secrets folder kept outside the repo (~/mcmodsready)
  for (const f of ['.env.analytics', join(homedir(), 'mcmodsready', '.env.analytics')]) {
    if (!existsSync(f)) continue;
    const m = /^CF_ANALYTICS_TOKEN=(.+)$/m.exec(readFileSync(f, 'utf8'));
    if (m) return m[1].trim();
  }
  console.error('No token. Put CF_ANALYTICS_TOKEN=... in .env.analytics (see README).');
  process.exit(1);
}
const TOKEN = token();

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data!;
}

async function sql(q: string): Promise<{ data: Record<string, string | number>[] }> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: q,
  });
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ data: Record<string, string | number>[] }>;
}

const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
type Group = { count: number; sum: { visits: number }; dimensions: Record<string, string> };
type Rum = { viewer: { accounts: { daily: Group[]; paths: Group[]; refs: Group[]; countries: Group[] }[] } };

const rum = await graphql<Rum>(
  `query ($acc: string!, $since: Date!) {
    viewer { accounts(filter: { accountTag: $acc }) {
      daily: rumPageloadEventsAdaptiveGroups(limit: 50, filter: { date_geq: $since }, orderBy: [date_ASC]) { count sum { visits } dimensions { date } }
      paths: rumPageloadEventsAdaptiveGroups(limit: 10, filter: { date_geq: $since }, orderBy: [count_DESC]) { count sum { visits } dimensions { requestPath } }
      refs: rumPageloadEventsAdaptiveGroups(limit: 10, filter: { date_geq: $since, refererHost_neq: "" }, orderBy: [count_DESC]) { count sum { visits } dimensions { refererHost } }
      countries: rumPageloadEventsAdaptiveGroups(limit: 5, filter: { date_geq: $since }, orderBy: [count_DESC]) { count sum { visits } dimensions { countryName } }
    } }
  }`,
  { acc: ACCOUNT, since },
);
const a = rum.viewer.accounts[0];
// Web Analytics samples at low volume (shown as ~10x counts); figures are estimates.
const totalViews = a.daily.reduce((s, d) => s + d.count, 0);
const totalVisits = a.daily.reduce((s, d) => s + d.sum.visits, 0);

console.log(`\nmcmodsready: last ${days} days (since ${since})\n`);
console.log(`Visits: ${totalVisits}   Page views: ${totalViews}\n`);
console.log('By day:');
for (const d of a.daily) console.log(`  ${d.dimensions.date}  ${String(d.sum.visits).padStart(5)} visits  ${String(d.count).padStart(5)} views`);
console.log('\nTop pages:');
for (const p of a.paths) console.log(`  ${String(p.count).padStart(5)}  ${p.dimensions.requestPath}`);
console.log('\nReferrers:');
if (!a.refs.length) console.log('  (none yet)');
for (const r of a.refs) console.log(`  ${String(r.count).padStart(5)}  ${r.dimensions.refererHost}`);
console.log('\nCountries:');
for (const c of a.countries) console.log(`  ${String(c.count).padStart(5)}  ${c.dimensions.countryName}`);

try {
  const clicks = await sql(
    `SELECT blob1 AS kind, blob2 AS what, blob3 AS site, SUM(_sample_interval) AS n FROM mcmodsready_clicks
     WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY kind, what, site ORDER BY n DESC LIMIT 30`,
  );
  const badges = clicks.data.filter((r) => r.kind === 'badge');
  const aff = clicks.data.filter((r) => r.kind !== 'badge');
  console.log('\nAffiliate clicks (/go/):');
  if (!aff.length) console.log('  (none yet)');
  for (const r of aff) console.log(`  ${String(r.n).padStart(5)}  ${r.kind} from ${r.what || '?'}`);
  console.log('\nBadge loads:');
  if (!badges.length) console.log('  (none yet)');
  for (const r of badges) console.log(`  ${String(r.n).padStart(5)}  ${r.what}${r.site ? `  on ${r.site}` : ''}`);
} catch (e) {
  console.log(`\n(Click/badge counts unavailable: ${(e as Error).message})`);
}
console.log();
