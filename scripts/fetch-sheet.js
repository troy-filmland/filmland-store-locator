import { parse } from 'csv-parse/sync';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SHEET_CSV_URL = process.env.SHEET_CSV_URL;

if (!SHEET_CSV_URL) {
  console.error('Error: SHEET_CSV_URL environment variable is required');
  process.exit(1);
}

// Product abbreviation → full name
const PRODUCT_MAP = {
  MM:   'Moonlight Mayhem!',
  MMEC: 'Moonlight Mayhem! Extended Cut',
  RR:   'Ryes of the Robots',
  RREC: 'Ryes of the Robot Extended Cut',
  QUAD: 'Quadraforce Blended Bourbon',
  MMWP: 'Moonlight Mayhem! 2 the White Port Wolf',
};

const PRODUCT_ABBREVS = Object.keys(PRODUCT_MAP);

async function fetchStores() {
  try {
    console.log('Fetching store data from Google Sheets...');
    const response = await fetch(SHEET_CSV_URL);

    if (!response.ok) {
      throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
    }

    const csvText = await response.text();

    // Parse CSV
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Parsed ${records.length} rows from CSV`);

    // Transform and filter records
    const stores = records
      .filter(row => {
        const lat = parseFloat(row.lat);
        const lng = parseFloat(row.lng);
        return !isNaN(lat) && !isNaN(lng);
      })
      .map(row => {
        // Collect full product names where abbreviated column is TRUE
        const products = PRODUCT_ABBREVS
          .filter(abbrev => row[abbrev] && row[abbrev].toUpperCase() === 'TRUE')
          .map(abbrev => PRODUCT_MAP[abbrev]);

        return {
          name: row.store_name || '',
          address: row.address || '',
          city: row.city || '',
          state: row.state || '',
          zip: row.zip || '',
          phone: row.phone || '',
          website: row.website || '',
          type: row.type || '',
          lat: parseFloat(row.lat),
          lng: parseFloat(row.lng),
          products: products
        };
      });

    console.log(`Filtered to ${stores.length} stores with valid coordinates`);

    // Write to data/stores.json
    const outputPath = join(__dirname, '../data/stores.json');
    writeFileSync(outputPath, JSON.stringify(stores, null, 2));

    console.log(`Successfully wrote ${stores.length} stores to ${outputPath}`);
  } catch (error) {
    console.error('Error fetching stores:', error);
    process.exit(1);
  }
}

fetchStores();
