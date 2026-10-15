// Refuse to build+deploy from a machine whose data is stale. Pre-rendered pages bake the data in,
// so deploying old local data overwrites the fresher nightly build.
// Usage: npx tsx pipeline/check-fresh.ts [maxAgeHours=6]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.DATA_DIR ?? 'public/data';
const maxHours = Number(process.argv[2] ?? 6);
const { generatedAt } = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { generatedAt: string };
const hours = (Date.now() - Date.parse(generatedAt)) / 3.6e6;
if (hours > maxHours) {
  console.error(`Data in ${dir} is ${hours.toFixed(1)}h old (max ${maxHours}h). Run \`npm run data\` first, or let the nightly workflow deploy.`);
  process.exit(1);
}
console.log(`Data is ${hours.toFixed(1)}h old: OK to deploy.`);
