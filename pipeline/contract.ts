// Contract check: fail loudly if the Modrinth v2 or Mojang response shapes change.
// Runs before every pipeline run. Usage: npx tsx pipeline/contract.ts
import { fetchManifest } from './mojang';
import { projects, versions } from './modrinth';

const problems: string[] = [];
const expect = (ok: boolean, msg: string) => ok || problems.push(msg);
const isStr = (x: unknown) => typeof x === 'string';
const isArr = (x: unknown) => Array.isArray(x);

const manifest = await fetchManifest();
expect(isStr(manifest.latest?.release), 'mojang: latest.release');
expect(isArr(manifest.versions) && manifest.versions.every((v) => isStr(v.id) && isStr(v.type) && isStr(v.releaseTime)), 'mojang: versions[]');

// Sodium (AANobbMI) is long-lived and multi-loader: a good canary.
const [p] = await projects(['AANobbMI']);
expect(!!p, 'modrinth: bulk project lookup');
if (p) {
  for (const k of ['id', 'slug', 'title', 'description', 'client_side', 'server_side', 'updated', 'project_type'] as const)
    expect(isStr(p[k]), `modrinth project.${k}`);
  for (const k of ['categories', 'loaders'] as const) expect(isArr(p[k]), `modrinth project.${k}`);
  expect(typeof p.downloads === 'number', 'modrinth project.downloads');
}
const vs = await versions('AANobbMI');
expect(vs.length > 0, 'modrinth: version list');
const v = vs[0];
if (v) {
  expect(isArr(v.game_versions) && isArr(v.loaders), 'modrinth version.game_versions/loaders');
  expect(['release', 'beta', 'alpha'].includes(v.version_type), `modrinth version.version_type=${v.version_type}`);
  expect(!Number.isNaN(Date.parse(v.date_published)), 'modrinth version.date_published');
}

if (problems.length) {
  console.error('API contract check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('API contract OK');
