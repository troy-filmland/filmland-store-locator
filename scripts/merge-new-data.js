import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../data');
const SHEET_EXPORT = join(DATA_DIR, 'current-sheet-export.csv');
const ORIGINAL_IMPORT = join(DATA_DIR, 'original-import.csv');
const NEW_PIVOT = join(DATA_DIR, 'initial-import.csv');
const OUTPUT_FILE = join(DATA_DIR, 'new-stores-to-add.csv');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function storeKey(name, city, state) {
  return norm(name) + '|' + norm(city) + '|' + norm(state);
}

function main() {
  // Read current sheet (what's live now, with manual edits)
  const sheetRows = parse(readFileSync(SHEET_EXPORT, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Current sheet: ${sheetRows.length} stores`);

  // Read original import (what was first imported into the sheet)
  const origRows = parse(readFileSync(ORIGINAL_IMPORT, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Original import: ${origRows.length} stores`);

  // Read new pivot data
  const newRows = parse(readFileSync(NEW_PIVOT, 'utf-8'), { columns: true, skip_empty_lines: true, trim: true });
  console.log(`New pivot data: ${newRows.length} stores`);

  // Build set of stores you deliberately removed (in original but not in current sheet)
  const currentKeys = new Set(sheetRows.map(r => storeKey(r.store_name, r.city, r.state)));
  const origKeys = new Set(origRows.map(r => storeKey(r.store_name, r.city, r.state)));

  const removedKeys = new Set();
  for (const r of origRows) {
    const key = storeKey(r.store_name, r.city, r.state);
    if (!currentKeys.has(key)) {
      removedKeys.add(key);
    }
  }
  console.log(`\nStores you previously removed: ${removedKeys.size}`);

  // Junk filter: exclude samples, warehouses, online retailers, non-stores
  const junkPatterns = [
    /sample/i, /breakage/i, /bill\s*back/i, /quail.*distribut/i,
    /warehouse$/i,
  ];
  const junkNames = new Set(['sendsips', 'wine.com'].map(norm));

  function isJunk(row) {
    const name = row.store_name;
    if (junkPatterns.some(p => p.test(name))) return true;
    if (junkNames.has(norm(name))) return true;
    if (!row.address || row.address === 'Total' || row.address === '.') return true;
    return false;
  }

  // Find genuinely new stores:
  // - Not already in current sheet
  // - Not in the removed/blacklist set
  // - Not junk
  const newStores = [];
  let existingCount = 0;
  let blockedCount = 0;
  let junkCount = 0;
  const seen = new Set();

  for (const row of newRows) {
    const key = storeKey(row.store_name, row.city, row.state);
    if (currentKeys.has(key)) {
      existingCount++;
    } else if (removedKeys.has(key)) {
      blockedCount++;
    } else if (isJunk(row)) {
      junkCount++;
      console.log(`  Filtered junk: ${row.store_name} | ${row.address}`);
    } else if (seen.has(key)) {
      junkCount++;
      console.log(`  Filtered dupe: ${row.store_name} | ${row.city}, ${row.state}`);
    } else {
      seen.add(key);
      newStores.push(row);
    }
  }

  console.log(`\n--- RESULTS ---`);
  console.log(`Already in sheet: ${existingCount}`);
  console.log(`Blocked (previously removed): ${blockedCount}`);
  console.log(`Filtered (junk/dupes): ${junkCount}`);
  console.log(`New stores to add: ${newStores.length}`);

  // Write new stores CSV
  if (newStores.length > 0) {
    const header = 'store_name,address,city,state,zip,phone,type,lat,lng,MM,MMEC,RR,RREC,QUAD,MMWP';
    const lines = [header];

    for (const store of newStores) {
      const fields = [
        store.store_name, store.address, store.city, store.state, store.zip,
        store.phone, store.type, '', '',
        store.MM, store.MMEC, store.RR, store.RREC, store.QUAD, store.MMWP
      ].map(f => {
        const s = String(f || '');
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(fields.join(','));
    }

    writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
    console.log(`\nWrote ${newStores.length} new stores to ${OUTPUT_FILE}`);
  } else {
    console.log('\nNo new stores to add.');
  }

  // Show blocked stores for reference
  if (blockedCount > 0) {
    console.log(`\n--- BLOCKED STORES (previously removed, not re-added) ---`);
    for (const row of newRows) {
      const key = storeKey(row.store_name, row.city, row.state);
      if (removedKeys.has(key)) {
        console.log(`  ${row.store_name} | ${row.address}, ${row.city}, ${row.state} ${row.zip}`);
      }
    }
  }
}

main();
