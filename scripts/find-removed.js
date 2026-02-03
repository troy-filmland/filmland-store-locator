import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '../data');

const orig = parse(readFileSync(join(DATA_DIR, 'original-import.csv'), 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
const current = parse(readFileSync(join(DATA_DIR, 'current-sheet-export.csv'), 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Match by store_name + city + state since addresses got normalized
const currentKeys = new Set(current.map(r => norm(r.store_name) + '|' + norm(r.city) + '|' + norm(r.state)));

const removed = orig.filter(r => {
  const key = norm(r.store_name) + '|' + norm(r.city) + '|' + norm(r.state);
  return !currentKeys.has(key);
});

console.log(`Original import: ${orig.length} stores`);
console.log(`Current sheet: ${current.length} stores`);
console.log(`Stores you removed: ${removed.length}\n`);

removed.forEach(r => {
  console.log(`  ${r.store_name} | ${r.address}, ${r.city}, ${r.state} ${r.zip}`);
});
