import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rows = parse(readFileSync(join(__dirname, '../data/current-sheet-export.csv'), 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });

const flagged = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const name = (r.store_name || '').toLowerCase();
  const addr = (r.address || '').toLowerCase();
  const hasCoords = r.lat && r.lng && r.lat !== '' && r.lng !== '';
  let issue = '';

  if (name.includes('sample') || name.includes('bill back') || name.includes('billback')) {
    issue = 'Samples / bill-back';
  } else if (name.includes('breakage')) {
    issue = 'Breakage';
  } else if (/warehouse$/i.test(r.store_name)) {
    issue = 'Warehouse';
  } else if (name === 'sendsips' || name === 'wine.com') {
    issue = 'Online retailer';
  } else if (!r.address || r.address === '.' || r.address === 'Total') {
    issue = 'No address';
  } else if (/^[a-zA-Z]/.test(r.address) && (addr.includes(' llc') || addr.includes(' inc')) && !/\d/.test(r.address)) {
    issue = 'Corporate name instead of street address';
  }

  if (issue) {
    flagged.push({
      row: i + 2,
      issue,
      store_name: r.store_name,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      has_lat_lng: hasCoords ? 'Yes' : 'No'
    });
  }
}

// Find duplicates
const seen = new Map();
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const key = (r.store_name + '|' + r.city + '|' + r.state).toLowerCase().replace(/[^a-z0-9|]/g, '');
  const hasCoords = r.lat && r.lng && r.lat !== '' && r.lng !== '';
  if (seen.has(key)) {
    flagged.push({
      row: i + 2,
      issue: `Duplicate of row ${seen.get(key) + 2}`,
      store_name: r.store_name,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      has_lat_lng: hasCoords ? 'Yes' : 'No'
    });
  } else {
    seen.set(key, i);
  }
}

// Sort by row number
flagged.sort((a, b) => a.row - b.row);

// Write CSV
const header = 'sheet_row,issue,store_name,address,city,state,zip,has_lat_lng';
const lines = [header];
for (const f of flagged) {
  const fields = [f.row, f.issue, f.store_name, f.address, f.city, f.state, f.zip, f.has_lat_lng];
  lines.push(fields.map(v => {
    const s = String(v || '');
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
}

writeFileSync(join(__dirname, '../data/rows-to-review.csv'), lines.join('\n'), 'utf-8');
console.log(`Wrote ${flagged.length} rows to data/rows-to-review.csv`);
