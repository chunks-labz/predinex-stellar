import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const snapshotPath = resolve(here, '../schema/openapi.json');
const source = process.env.SCHEMA_SOURCE === 'dist'
  ? '../dist/config/swagger.js'
  : '../src/config/swagger.ts';
const { openApiDoc } = await import(resolve(here, source));
const output = `${JSON.stringify(openApiDoc, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current;
  try { current = readFileSync(snapshotPath, 'utf8'); } catch {
    console.error(`Schema snapshot missing: ${snapshotPath}`);
    process.exit(1);
  }
  if (current !== output) {
    console.error('API schema drift detected. Run npm run schema:update in api/.');
    process.exit(1);
  }
  process.exit(0);
}

writeFileSync(snapshotPath, output);
console.log(`Wrote ${snapshotPath}`);
