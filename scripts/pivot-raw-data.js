import XLSX from 'xlsx';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../data');
const OUTPUT_FILE = join(DATA_DIR, 'initial-import.csv');

const INPUT_FILE = join(DATA_DIR, 'on and off premise full store list.xlsx');

// Product abbreviation → full name (order matters for CSV columns)
const PRODUCT_MAP = {
  MM:   'Moonlight Mayhem!',
  MMEC: 'Moonlight Mayhem! Extended Cut',
  RR:   'Ryes of the Robots',
  RREC: 'Ryes of the Robot Extended Cut',
  QUAD: 'Quadraforce Blended Bourbon',
  MMWP: 'Moonlight Mayhem! 2 the White Port Wolf',
};

const PRODUCT_ABBREVS = Object.keys(PRODUCT_MAP);

/**
 * Normalize a raw Item Name to its abbreviation key, or null if unrecognised / excluded.
 */
function matchProduct(rawName) {
  if (!rawName) return null;

  // Strip pack-size suffix like "6/750 ml"
  let name = rawName.replace(/\s+\d+\/\d+\s*ml$/i, '').replace(/\s+\d+\/\d+$/i, '').trim();

  // Normalise to lower for comparison
  const lower = name.toLowerCase();

  // Exclude sold-out product
  if (lower.includes('town at the end of tomorrow')) return null;

  // Match against known products.
  // Raw data may lack "!", may omit words like "the", or have extra suffixes like "Single Barrel".
  // Strategy: check if the normalised raw name starts with the normalised full name,
  // or use special-case matching for tricky names.
  // We also need to handle "Moonlight Mayhem 2 White Port Wolf" → MMWP (raw lacks "the")

  // Normalise: lowercase, strip "!", collapse whitespace
  const norm = (s) => s.toLowerCase().replace(/!/g, '').replace(/\s+/g, ' ').trim();

  const normRaw = norm(lower);

  // Special case first: raw "moonlight mayhem 2 white port wolf" (missing "the")
  if (normRaw.includes('mayhem') && normRaw.includes('2') && normRaw.includes('white port wolf')) {
    return 'MMWP';
  }

  // Try exact match first, then startsWith
  // Process in reverse key order (longest full names first) to avoid partial matches
  const entries = Object.entries(PRODUCT_MAP).sort((a, b) => b[1].length - a[1].length);

  for (const [abbrev, fullName] of entries) {
    const normFull = norm(fullName);
    if (normRaw === normFull || normRaw.startsWith(normFull)) return abbrev;
  }

  return null;
}

/**
 * Clean phone number: extract digits, format as (XXX) XXX-XXXX
 */
function cleanPhone(phone) {
  if (!phone || phone === '0' || phone === '1' || phone === 0 || phone === 1) return '';

  let digits = String(phone).replace(/\D/g, '');

  // Excel pads some 10-digit numbers with trailing zeros to 19-20 digits
  if (digits.length > 11) {
    digits = digits.replace(/0+$/, '');
  }

  // Remove leading 1 (country code) if 11 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) return '';

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Create a dedup key from address fields
 */
function createStoreKey(address, city, state, zip) {
  return `${address}|${city}|${state}|${zip}`.toLowerCase().trim();
}

/**
 * Read the combined xlsx file and return rows as objects.
 * Header at row index 1, data starts at row index 2.
 */
function readXlsx(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays (raw)
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Header row is at index 1
  const headers = raw[1].map(h => String(h).trim());

  // Data rows start at index 2
  const rows = [];
  for (let i = 2; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length === 0) continue;

    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] !== undefined ? row[idx] : '';
    });
    rows.push(obj);
  }

  return rows;
}

/**
 * Escape a CSV field
 */
function escapeCsvField(field) {
  const s = String(field);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Main pivot logic
 */
function pivotRawData() {
  try {
    console.log('Reading xlsx file...');

    const allRows = readXlsx(INPUT_FILE);
    console.log(`Total raw rows: ${allRows.length}`);

    const storesMap = new Map();

    for (const row of allRows) {
      const address = String(row['Address'] || '').trim();
      const city = String(row['City'] || '').trim();
      const state = String(row['State'] || row['Dist. STATE'] || '').trim();
      const zip = String(row['Zip Code'] || '').trim();
      const storeName = String(row['Retail Accounts'] || '').trim();
      const itemName = String(row['Item Names'] || '').trim();
      const onOff = String(row['OnOff Premises'] || '').trim().toUpperCase();

      // Skip total/summary rows
      if (!address || !city || address === 'Total' || city === 'Total' || storeName === 'Total') continue;

      // Determine type from OnOff Premises column
      const type = onOff === 'ON' ? 'On-Premise' : 'Off-Premise';

      const storeKey = createStoreKey(address, city, state, zip);

      if (!storesMap.has(storeKey)) {
        storesMap.set(storeKey, {
          store_name: storeName,
          address,
          city,
          state,
          zip,
          phone: cleanPhone(row['Phone']),
          type,
          lat: '',
          lng: '',
          products: new Set(),
        });
      }

      const store = storesMap.get(storeKey);

      // Capture phone if missing
      if (!store.phone) {
        const p = cleanPhone(row['Phone']);
        if (p) store.phone = p;
      }

      // Match product
      const abbrev = matchProduct(itemName);
      if (abbrev) {
        store.products.add(abbrev);
      }
    }

    console.log(`Found ${storesMap.size} unique stores`);

    // Build CSV
    const header = ['store_name', 'address', 'city', 'state', 'zip', 'phone', 'type', 'lat', 'lng', ...PRODUCT_ABBREVS].join(',');
    const lines = [header];

    for (const store of storesMap.values()) {
      const productCols = PRODUCT_ABBREVS.map(a => store.products.has(a) ? 'TRUE' : 'FALSE');
      lines.push([
        escapeCsvField(store.store_name),
        escapeCsvField(store.address),
        escapeCsvField(store.city),
        escapeCsvField(store.state),
        escapeCsvField(store.zip),
        escapeCsvField(store.phone),
        escapeCsvField(store.type),
        store.lat,
        store.lng,
        ...productCols,
      ].join(','));
    }

    writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
    console.log(`\nSuccess! Created ${OUTPUT_FILE}`);
    console.log(`Total stores: ${storesMap.size}`);

    // Show product summary
    const productCounts = {};
    PRODUCT_ABBREVS.forEach(a => { productCounts[a] = 0; });
    for (const store of storesMap.values()) {
      for (const a of store.products) {
        productCounts[a]++;
      }
    }
    console.log('\nProduct counts:');
    for (const [a, count] of Object.entries(productCounts)) {
      console.log(`  ${a} (${PRODUCT_MAP[a]}): ${count} stores`);
    }

  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

pivotRawData();
