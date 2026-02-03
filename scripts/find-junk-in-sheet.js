import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rows = parse(readFileSync(join(__dirname, '../data/current-sheet-export.csv'), 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });

console.log(`Total stores in sheet: ${rows.length}\n`);

const junk = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const name = (r.store_name || '').toLowerCase();
  const addr = (r.address || '').toLowerCase();
  const city = (r.city || '').toLowerCase();
  let reason = '';

  // Samples, breakage, bill-back
  if (name.includes('sample')) reason = 'samples';
  else if (name.includes('breakage')) reason = 'breakage';
  else if (name.includes('bill back') || name.includes('billback')) reason = 'bill back';
  // Filmland's own address
  else if (name.includes('filmland spirits') && !name.includes('total wine')) reason = 'own company';
  else if (addr.includes('cantlay')) reason = 'Filmland HQ address';
  // Distributor/warehouse entries
  else if (name.includes('quail distribut')) reason = 'distributor';
  else if (/warehouse$/i.test(r.store_name) && !name.includes('beverage')) reason = 'warehouse';
  // Personal names (not businesses)
  else if (name === 'eric crane' || name === 'thomas davis') reason = 'personal name, not a store';
  // No real address
  else if (!r.address || r.address === '.' || r.address === 'Total') reason = 'no address';
  // Address is a company name (LLC/Inc with no street number)
  else if (/^[a-zA-Z]/.test(r.address) && (addr.includes(' llc') || addr.includes(' inc')) && !/\d/.test(r.address)) reason = 'corporate address, not street';
  // Online retailer
  else if (name === 'sendsips' || name === 'wine.com') reason = 'online retailer';
  // Duplicate check: same normalized name+city appears twice
  // (handled separately below)

  if (reason) {
    junk.push({ row: i + 2, name: r.store_name, address: r.address, city: r.city, state: r.state, reason });
  }
}

// Find duplicates
const seen = new Map();
const dupes = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const key = (r.store_name + '|' + r.city + '|' + r.state).toLowerCase().replace(/[^a-z0-9|]/g, '');
  if (seen.has(key)) {
    dupes.push({ row: i + 2, name: r.store_name, city: r.city, state: r.state, firstRow: seen.get(key) + 2 });
  } else {
    seen.set(key, i);
  }
}

if (junk.length > 0) {
  console.log(`--- JUNK TO REMOVE (${junk.length} rows) ---`);
  junk.forEach(j => {
    console.log(`  Row ${j.row}: ${j.name} | ${j.address}, ${j.city}, ${j.state} — ${j.reason}`);
  });
}

if (dupes.length > 0) {
  console.log(`\n--- DUPLICATES (${dupes.length} rows) ---`);
  dupes.forEach(d => {
    console.log(`  Row ${d.row}: ${d.name} | ${d.city}, ${d.state} — duplicate of row ${d.firstRow}`);
  });
}

if (junk.length === 0 && dupes.length === 0) {
  console.log('No junk or duplicates found.');
}

console.log(`\nTotal to remove: ${junk.length + dupes.length}`);
