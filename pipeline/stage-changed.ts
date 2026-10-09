// Upload only what changed. Compares every file in <out> with a hash manifest from the last publish,
// copies new/changed files into <stage> (same layout) and writes <stage>/../deleted.txt for files
// that disappeared. R2 charges per write, so re-uploading ~15k unchanged files every run would add up.
// Usage: npx tsx pipeline/stage-changed.ts <outDir> <stageDir> <manifest.json>
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

export async function stage(outDir: string, stageDir: string, manifestPath: string) {
  const prev: Record<string, string> = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
  const next: Record<string, string> = {};
  let changed = 0;
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  for (const file of await walk(outDir)) {
    const rel = relative(outDir, file).split('\\').join('/');
    const hash = createHash('sha1').update(await readFile(file)).digest('hex');
    next[rel] = hash;
    if (prev[rel] !== hash) {
      const dest = join(stageDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(file, dest);
      changed++;
    }
  }
  const deleted = Object.keys(prev).filter((k) => !(k in next));
  await writeFile(join(dirname(stageDir), 'deleted.txt'), deleted.join('\n') + (deleted.length ? '\n' : ''));
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(next));
  return { total: Object.keys(next).length, changed, deleted: deleted.length };
}

if (process.argv[1]?.endsWith('stage-changed.ts')) {
  const [outDir, stageDir, manifest] = process.argv.slice(2);
  const r = await stage(outDir, stageDir, manifest);
  console.log(`[stage] ${r.changed} of ${r.total} files changed, ${r.deleted} deleted`);
}
