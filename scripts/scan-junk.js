import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rows = parse(readFileSync(join(__dirname, '../data/new-stores-to-add.csv'), 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });

const suspicious = rows.filter(r => {
  const n = r.store_name.toLowerCase();
  const a = r.address.toLowerCase();
  return n.includes('sample') || n.includes('breakage') || n.includes('filmland') ||
    n.includes('quail') || n.includes('warehouse') || a.includes('llc') ||
    a.includes('inc') || a.includes('cantlay') || n.includes('total') ||
    a.includes('bluegrass') || a.includes('enterprises') || a.includes('hotels') ||
    a.includes('resorts') || r.address === '' || r.address === 'Total';
});

console.log(`Suspicious entries (${suspicious.length}):`);
suspicious.forEach(r => console.log(`  ${r.store_name} | ${r.address}, ${r.city}, ${r.state} ${r.zip}`));

// Check for dupes within the file
const keys = new Map();
let dupes = 0;
for (const r of rows) {
  const k = (r.store_name + '|' + r.city + '|' + r.state).toLowerCase().replace(/[^a-z0-9|]/g, '');
  if (keys.has(k)) {
    dupes++;
    console.log(`  DUPE: ${r.store_name} | ${r.city}, ${r.state}`);
  }
  keys.set(k, true);
}

console.log(`\nDuplicates within new stores: ${dupes}`);
console.log(`Total new stores: ${rows.length}`);
