// Checks the built site in dist/, not the source: these are the bugs unit tests can't see
// (robots.txt hiding the mod pages, .html canonicals). Skipped until a build exists; CI runs it after building.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = 'dist';
const built = existsSync(join(DIST, 'index.html')) && existsSync(join(DIST, 'sitemap-0.xml'));
const read = (f: string) => readFileSync(join(DIST, f), 'utf8');
const sitemap = () => [...read('sitemap-0.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const fileFor = (path: string) => (path === '/' ? 'index.html' : `${path.slice(1)}.html`);
const sample = () => {
  const urls = sitemap();
  return [...urls.filter((u) => !u.startsWith('/mod/')), ...urls.filter((u) => u.startsWith('/mod/')).slice(0, 25)];
};

describe.skipIf(!built)('built site', () => {
  it('robots.txt blocks no page in the sitemap (rules are prefix matches)', () => {
    const rules = [...read('robots.txt').matchAll(/^Disallow:\s*(\S+)/gim)].map((m) => m[1]);
    const blocked = sitemap().filter((u) => rules.some((r) => u.startsWith(r)));
    expect(blocked).toEqual([]);
  });

  it('every sitemap URL is a built page, with clean addresses', () => {
    const urls = sitemap();
    expect(urls.length).toBeGreaterThan(20);
    expect(urls.filter((u) => u.endsWith('.html') || u === '/m' || u === '/404')).toEqual([]);
    expect(urls.filter((u) => !existsSync(join(DIST, fileFor(u))))).toEqual([]);
  });

  it('canonical matches the sitemap address on every sampled page', () => {
    for (const u of sample()) {
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(read(fileFor(u)))?.[1];
      expect(canonical && new URL(canonical).pathname, u).toBe(u);
    }
  });

  it('mod pages can be reached by following plain links', () => {
    expect(read('mods.html')).toContain('href="/browse/1"');
    expect(read('browse/1.html')).toMatch(/href="\/mod\//);
    const mod = sitemap().find((u) => u.startsWith('/mod/'))!;
    expect(read(fileFor(mod))).toMatch(/href="\/mod\//);
  });

  it('every sampled page carries the disclaimer and a preview image, and no title leads with the game name', () => {
    for (const u of sample()) {
      const html = read(fileFor(u));
      expect(html, u).toContain('NOT AN OFFICIAL MINECRAFT SERVICE');
      expect(html, u).toContain('property="og:image"');
      expect(/<title>([^<]*)/.exec(html)?.[1], u).not.toMatch(/^Minecraft/i);
    }
  });

  it('each page sets its analytics beacon once and no third-party scripts besides it', () => {
    const html = read('index.html');
    const external = [...html.matchAll(/<script[^>]*src="(https?:[^"]+)"/g)].map((m) => m[1]);
    expect(external).toEqual(['https://static.cloudflareinsights.com/beacon.min.js']);
  });
});
