// Mobile Lighthouse scores for key pages. Chrome is started by Playwright and Lighthouse attaches to it.
// Usage: npx tsx pipeline/perf.ts [baseUrl] [--min 90]
import { chromium } from '@playwright/test';
import { exec } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const base = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://mcmodsready.com';
const PAGES = ['/', '/mods', '/list', '/mod/sodium', '/report/26.3'];
const minArg = process.argv.indexOf('--min');
const MIN = minArg > 0 ? Number(process.argv[minArg + 1]) : 90;
const PORT = 9333;
const run = promisify(exec);

interface Report {
  categories: Record<string, { score: number; auditRefs: { id: string }[] }>;
  audits: Record<string, { score: number | null; displayValue?: string }>;
}

const dir = mkdtempSync(join(tmpdir(), 'lh-'));
const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
const failures: string[] = [];
try {
  for (const p of PAGES) {
    const out = join(dir, `${p.replace(/\W/g, '_')}.json`);
    await run(
      `npx -y lighthouse@12 "${base + p}" --port=${PORT} --quiet --form-factor=mobile --only-categories=performance,accessibility,seo --output=json --output-path="${out}"`,
      { timeout: 150_000 },
    );
    const { categories: c, audits: a } = JSON.parse(readFileSync(out, 'utf8')) as Report;
    const score = (k: string) => Math.round(c[k].score * 100);
    console.log(
      `${p.padEnd(14)} perf ${score('performance')}  a11y ${score('accessibility')}  seo ${score('seo')}  | LCP ${a['largest-contentful-paint'].displayValue}  TBT ${a['total-blocking-time'].displayValue}  CLS ${a['cumulative-layout-shift'].displayValue}  weight ${a['total-byte-weight'].displayValue}`,
    );
    for (const k of ['accessibility', 'seo']) {
      for (const { id } of c[k].auditRefs) if (a[id] && a[id].score !== null && a[id].score! < 1) console.log(`    ${k}: ${id}`);
    }
    for (const id of ['unused-javascript', 'render-blocking-resources', 'font-display', 'server-response-time']) {
      if (a[id] && a[id].score !== null && a[id].score! < 0.9) console.log(`    perf: ${id} ${a[id].displayValue ?? ''}`);
    }
    if (score('performance') < MIN) failures.push(`${p}: performance ${score('performance')} < ${MIN}`);
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error('Below target:\n- ' + failures.join('\n- '));
  process.exit(1);
}
