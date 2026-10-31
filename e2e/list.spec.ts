// Browser tests against the built site with fixture data. Modrinth is stubbed so they're hermetic.
import { expect, test, type Page } from '@playwright/test';

const OBSCURE = {
  id: 'OBSCURE1',
  slug: 'obscure-mod',
  title: 'Obscure Mod',
  description: 'A little mod below the download threshold',
  icon_url: null,
  downloads: 1234,
  categories: ['utility'],
  loaders: ['fabric', 'forge'],
  project_type: 'mod',
  client_side: 'required',
  server_side: 'unsupported',
  environment: ['client_only'],
  updated: '2026-10-01T00:00:00Z',
};
const OBSCURE_VERSIONS = [
  { id: 'v1', project_id: OBSCURE.id, version_number: '1', game_versions: ['1.20.1'], loaders: ['forge'], version_type: 'release', date_published: '2023-07-01T00:00:00Z', dependencies: [] },
];

async function stubs(page: Page) {
  await page.route('https://static.cloudflareinsights.com/**', (r) => r.fulfill({ status: 200, body: '' }));
  await page.route('https://cdn.modrinth.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('https://api.modrinth.com/v2/projects?**', (r) => {
    const ids = JSON.parse(new URL(r.request().url()).searchParams.get('ids') ?? '[]') as string[];
    const known: Record<string, unknown> = {
      sodium: { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon_url: null, downloads: 1 },
      'fabric-api': { id: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API', icon_url: null, downloads: 1 },
      'obscure-mod': OBSCURE,
      OBSCURE1: OBSCURE,
    };
    return r.fulfill({ json: ids.map((i) => known[i]).filter(Boolean) });
  });
  await page.route('https://api.modrinth.com/v2/project/OBSCURE1/version**', (r) => r.fulfill({ json: OBSCURE_VERSIONS }));
  await page.route('https://api.modrinth.com/v2/search**', (r) => r.fulfill({ json: { hits: [] } }));
}

async function pasteMods(page: Page, text: string) {
  await page.getByText('Paste a list').click();
  await page.locator('textarea').fill(text);
  await page.getByRole('button', { name: 'Add these' }).click();
}

test.beforeEach(async ({ page }) => stubs(page));

test('pin a list, share it, open it in a clean browser: same result', async ({ page, browser }) => {
  await page.goto('/list');
  await pasteMods(page, 'sodium\nhttps://modrinth.com/mod/fabric-api\nnot-a-real-mod');
  await expect(page.getByRole('status').filter({ hasText: 'Added 2' })).toContainText('not-a-real-mod');
  await expect(page.locator('.mods li')).toHaveCount(2);
  const rings = await page.locator('.rings').innerText();
  const verdicts = await page.locator('.verdicts').innerText();

  const encoded = await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('mmr.lists.v1')!)[0];
    return new URLSearchParams({ v: '1', n: l.name, l: l.loader, t: l.target, m: l.mods.join('.') }).toString();
  });
  const fresh = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const other = await fresh.newPage();
  await stubs(other);
  await other.goto(`/list#${encoded}`);
  await expect(other.locator('.mods li')).toHaveCount(2);
  expect(await other.locator('.rings').innerText()).toBe(rings);
  expect(await other.locator('.verdicts').innerText()).toBe(verdicts);
  await fresh.close();
});

test('a mod below the download threshold works like any other, on an older version', async ({ page }) => {
  await page.goto('/list');
  await page.getByRole('button', { name: 'Forge', exact: true }).click();
  await page.locator('#target').selectOption('v:1.20.1');
  await pasteMods(page, 'obscure-mod');
  await expect(page.locator('.mods li').filter({ hasText: 'Obscure Mod' })).toContainText('Ready');
  await expect(page.locator('.verdicts')).toContainText('Players can update to 1.20.1');
});

test('no cookies are set', async ({ page, context }) => {
  for (const path of ['/', '/mods', '/list']) await page.goto(path);
  expect(await context.cookies()).toEqual([]);
});

test('the grid loads and can add an older-version column', async ({ page }) => {
  await page.goto('/mods?loader=forge&cols=1.20.1');
  await expect(page.locator('.matrix tbody tr').first()).toBeVisible();
  await expect(page.locator('.matrix thead')).toContainText('1.20.1');
});

test('the report chart renders with a label per loader', async ({ page }) => {
  await page.goto('/report/26.3');
  await expect(page.locator('.viz-root svg')).toBeVisible();
  for (const name of ['Fabric', 'NeoForge', 'Forge']) await expect(page.locator('.viz-root .dl', { hasText: new RegExp(`^${name} `) })).toBeVisible();
});

test('importing a modpack: files stay local, only hashes are sent', async ({ page }) => {
  const sent: string[] = [];
  await page.route('https://api.modrinth.com/v2/version_files', async (r) => {
    const body = r.request().postData() ?? '';
    sent.push(body);
    const { hashes } = JSON.parse(body) as { hashes: string[] };
    await r.fulfill({ json: { [hashes[0]]: { project_id: 'AANobbMI' } } });
  });
  await page.goto('/list');
  const { zipSync, strToU8 } = await import('fflate');
  const index = { name: 'Test Pack', dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16' }, files: [{ path: 'mods/a.jar', hashes: { sha1: 'a'.repeat(40) } }, { path: 'mods/b.jar', hashes: { sha1: 'b'.repeat(40) } }] };
  const buffer = Buffer.from(zipSync({ 'modrinth.index.json': strToU8(JSON.stringify(index)) }));
  await page.locator('input[type=file]').setInputFiles({ name: 'test.mrpack', mimeType: 'application/zip', buffer });
  await expect(page.locator('.mods li').filter({ hasText: 'Sodium' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 mod' })).toContainText('1 file(s) listed in the pack');
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0])).toEqual({ hashes: ['a'.repeat(40), 'b'.repeat(40)], algorithm: 'sha1' });
});

test('dropping a jar hashes it in the browser', async ({ page }) => {
  let hash = '';
  await page.route('https://api.modrinth.com/v2/version_files', async (r) => {
    hash = (JSON.parse(r.request().postData()!) as { hashes: string[] }).hashes[0];
    await r.fulfill({ json: { [hash]: { project_id: 'AANobbMI' } } });
  });
  await page.goto('/list');
  await page.locator('input[type=file]').setInputFiles({ name: 'x.jar', mimeType: 'application/java-archive', buffer: Buffer.from('hello') });
  await expect(page.locator('.mods li').filter({ hasText: 'Sodium' })).toBeVisible();
  expect(hash).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'); // sha1("hello")
});
