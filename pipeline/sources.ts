// Which GitHub repo each mod lives in, and which repos are forks, for spotting forks of a mod.
// Cached forever per mod/repo; a capped number of GitHub lookups per run, so the first pass spans several nights.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { projects } from './modrinth';

const SOURCES = '.cache/sources.json';
const PARENTS = '.cache/github-parents.json';
const GITHUB_BUDGET = 500;

const readJson = async <T>(f: string, fallback: T): Promise<T> => (existsSync(f) ? (JSON.parse(await readFile(f, 'utf8')) as T) : fallback);
async function writeJson(f: string, data: unknown) {
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(data));
}

/** "owner/repo" from a GitHub URL. */
export function repoOf(url: string | null | undefined): string | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(url ?? '');
  return m ? `${m[1]}/${m[2].replace(/\.git$/i, '')}` : null;
}

export async function loadRepos(ids: string[]): Promise<{ repos: Map<string, string>; parents: Map<string, string> }> {
  const sources = await readJson<Record<string, string | null>>(SOURCES, {});
  const unknown = ids.filter((id) => !(id in sources));
  if (unknown.length) {
    const found = await projects<{ id: string; source_url?: string | null }>(unknown);
    for (const id of unknown) sources[id] = null;
    for (const p of found) sources[p.id] = repoOf(p.source_url);
    await writeJson(SOURCES, sources);
  }
  const repos = new Map(ids.flatMap((id) => (sources[id] ? [[id, sources[id]!] as const] : [])));

  const known = await readJson<Record<string, string | null>>(PARENTS, {});
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const todo = [...new Set(repos.values())].filter((r) => !(r in known)).slice(0, GITHUB_BUDGET);
    for (const repo of todo) {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'mcmodsready-pipeline' },
      });
      if (res.status === 403 || res.status === 429) break; // rate limited: carry on next run
      if (res.status === 404) {
        known[repo] = null;
        continue;
      }
      if (!res.ok) continue;
      const j = (await res.json()) as { parent?: { full_name?: string } };
      known[repo] = j.parent?.full_name ?? null;
    }
    await writeJson(PARENTS, known);
  }
  const parents = new Map(Object.entries(known).flatMap(([k, v]) => (v ? [[k.toLowerCase(), v] as const] : [])));
  return { repos, parents };
}
