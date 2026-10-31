// Checks the live site after a deploy (and daily, from the health workflow).
// Usage: npx tsx pipeline/smoke.ts [baseUrl] [--max-age-hours N]
export {};

const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://mcmodsready.com';
const ageArg = process.argv.indexOf('--max-age-hours');
const maxAgeHours = ageArg > 0 ? Number(process.argv[ageArg + 1]) : 36;

const problems: string[] = [];
const get = (path: string) => fetch(base + path, { redirect: 'manual', headers: { 'user-agent': 'mcmodsready-smoke/1.0' } });

async function page(path: string, mustContain: string) {
  const r = await get(path);
  if (r.status !== 200) return void problems.push(`${path}: HTTP ${r.status}`);
  if (!(await r.text()).includes(mustContain)) problems.push(`${path}: missing "${mustContain}"`);
}

await page('/', 'NOT AN OFFICIAL MINECRAFT SERVICE');
await page('/mods', 'href="/browse/1"');
await page('/list', 'Is my mod list ready?');
await page('/browse/1', 'href="/mod/');
await page('/mod/sodium', 'rel="canonical" href="https://mcmodsready.com/mod/sodium"');
await page('/robots.txt', 'Sitemap:');
await page('/sitemap-index.xml', 'sitemap-0.xml');
await page('/report/26.1', 'How fast did mods update');

const robots = await (await get('/robots.txt')).text();
for (const line of robots.split('\n')) {
  const m = /^Disallow:\s*(\S+)/i.exec(line);
  if (m && ['/mods', '/mod/sodium', '/browse/1', '/report/26.1'].some((p) => p.startsWith(m[1]))) problems.push(`robots.txt: "${line.trim()}" blocks real pages`);
}

const meta = await get('/data/meta.json');
if (meta.status !== 200) problems.push(`/data/meta.json: HTTP ${meta.status}`);
else {
  const { generatedAt } = (await meta.json()) as { generatedAt: string };
  const hours = (Date.now() - Date.parse(generatedAt)) / 3.6e6;
  if (hours > maxAgeHours) problems.push(`data is ${hours.toFixed(1)}h old (max ${maxAgeHours}h)`);
}

const badge = await get('/badge/sodium.svg');
if (badge.status !== 200 || !badge.headers.get('content-type')?.includes('svg')) problems.push(`/badge/sodium.svg: HTTP ${badge.status}`);

const go = await get('/go/host');
if (go.status !== 302 || !go.headers.get('location')?.includes('apexminecrafthosting')) problems.push(`/go/host: HTTP ${go.status} -> ${go.headers.get('location')}`);

if (problems.length) {
  console.error('Smoke test failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Smoke test OK: ${base}`);
