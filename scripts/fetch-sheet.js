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
        // Skip rows with missing lat/lng
        const lat = parseFloat(row.lat);
        const lng = parseFloat(row.lng);
        return !isNaN(lat) && !isNaN(lng);
      })
      .map(row => {
        // Parse products from comma-separated string
        const products = row.products
          ? row.products.split(',').map(p => p.trim()).filter(p => p.length > 0)
          : [];

        return {
          name: row.store_name || '',
          address: row.address || '',
          city: row.city || '',
          state: row.state || '',
          zip: row.zip || '',
          phone: row.phone || '',
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
