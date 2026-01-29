import { parse } from 'csv-parse/sync';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INPUT_FILE = '/Users/troy/Filmland Website/Data/Acct Info 6 Month RAW DATA.csv';
const OUTPUT_FILE = join(__dirname, '../data/initial-import.csv');

/**
 * Clean product name by removing pack size suffix
 * Examples: "Moonlight Mayhem 6/750 ml" -> "Moonlight Mayhem"
 *           "Ryes of the Robots 12/750 ml" -> "Ryes of the Robots"
 */
function cleanProductName(productName) {
  if (!productName) return '';

  // Remove pack size pattern like "6/750 ml", "12/750 ml", etc.
  let cleaned = productName
    .replace(/\s+\d+\/\d+\s*ml$/i, '')
    .replace(/\s+\d+\/\d+$/i, '')
    .trim();

  // Normalize to title case to deduplicate variants like
  // "Ryes Of The Robot Extended Cut" vs "Ryes of the Robot Extended Cut"
  cleaned = cleaned.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  // Lowercase common small words (except at start)
  cleaned = cleaned.replace(/\s(Of|The|At|And|In|On|To|A|An)\b/g, m => m.toLowerCase());

  return cleaned;
}

/**
 * Clean phone number: extract digits, format as (XXX) XXX-XXXX
 * Handles: "0", Excel-padded "20520030780000000000", raw digits "12704951421"
 */
function cleanPhone(phone) {
  if (!phone || phone === '0' || phone === '1') return '';

  let digits = String(phone).replace(/\D/g, '');

  // Excel pads some 10-digit numbers with trailing zeros to 19-20 digits
  // Strip trailing zeros if the result is longer than 11 digits
  if (digits.length > 11) {
    digits = digits.replace(/0+$/, '');
  }

  // Remove leading 1 (country code) if 11 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  // Must be exactly 10 digits to be a valid US phone
  if (digits.length !== 10) return '';

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Create a unique key for a store based on address
 */
function createStoreKey(address, city, state, zip) {
  return `${address}|${city}|${state}|${zip}`.toLowerCase().trim();
}

/**
 * Pivot raw data and aggregate by store
 */
function pivotRawData() {
  try {
    console.log('Reading raw data file...');
    const csvContent = readFileSync(INPUT_FILE, 'utf-8');

    console.log('Parsing CSV...');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Parsed ${records.length} rows`);

    // Map to store unique stores
    const storesMap = new Map();

    // Process each row
    records.forEach((row, index) => {
      // Extract address fields (column names from CSV)
      const address = row.Address || '';
      const city = row.City || '';
      const state = row.State || '';
      const zip = row['Zip Code'] || '';

      // Skip summary/total rows and rows with missing address info
      if (!address || !city || !state || address === 'Total' || city === 'Total') {
        console.log(`Row ${index + 1}: Skipping - missing address fields`);
        return;
      }

      // Create unique key
      const storeKey = createStoreKey(address, city, state, zip);

      // Get or create store entry
      if (!storesMap.has(storeKey)) {
        // Extract store name from "Retail Accounts" column
        const storeName = row['Retail Accounts'] || '';

        const phone = cleanPhone(row.Phone);

        storesMap.set(storeKey, {
          store_name: storeName.trim(),
          address: address.trim(),
          city: city.trim(),
          state: state.trim(),
          zip: zip.trim(),
          phone: phone,
          type: '', // Empty - to be filled manually
          lat: '', // Empty - will be geocoded later
          lng: '', // Empty - will be geocoded later
          productsSet: new Set()
        });
      }

      // Add product to store's product set
      const store = storesMap.get(storeKey);

      // Capture phone if store doesn't have one yet
      if (!store.phone) {
        const rowPhone = cleanPhone(row.Phone);
        if (rowPhone) store.phone = rowPhone;
      }

      // Product name is in "Item Names" column
      const productName = row['Item Names'] || '';

      if (productName && productName !== 'Total') {
        const cleanedProduct = cleanProductName(productName);
        if (cleanedProduct) {
          store.productsSet.add(cleanedProduct);
        }
      }
    });

    console.log(`Found ${storesMap.size} unique stores`);

    // Convert to CSV format
    const outputRows = [];

    // Header row
    outputRows.push('store_name,address,city,state,zip,phone,type,lat,lng,products');

    // Data rows
    for (const store of storesMap.values()) {
      // Convert products set to comma-separated string
      const products = Array.from(store.productsSet).sort().join(', ');

      // Escape fields that contain commas or quotes
      const escapeCsvField = (field) => {
        if (field.includes(',') || field.includes('"') || field.includes('\n')) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      };

      outputRows.push([
        escapeCsvField(store.store_name),
        escapeCsvField(store.address),
        escapeCsvField(store.city),
        escapeCsvField(store.state),
        escapeCsvField(store.zip),
        escapeCsvField(store.phone),
        '', // type
        '', // lat
        '', // lng
        escapeCsvField(products)
      ].join(','));
    }

    // Write output file
    const outputContent = outputRows.join('\n');
    writeFileSync(OUTPUT_FILE, outputContent, 'utf-8');

    console.log(`\nSuccess! Created ${OUTPUT_FILE}`);
    console.log(`Total stores: ${storesMap.size}`);

    // Show sample of products found
    const allProducts = new Set();
    storesMap.forEach(store => {
      store.productsSet.forEach(product => allProducts.add(product));
    });
    console.log(`\nUnique products found: ${allProducts.size}`);
    console.log('Products:', Array.from(allProducts).sort().join(', '));

  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

// Run the pivot
pivotRawData();
