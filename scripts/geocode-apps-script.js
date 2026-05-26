/**
 * Filmland Store Locator - Google Apps Script
 *
 * This script runs inside Google Sheets (Extensions > Apps Script)
 *
 * Setup:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this code
 * 4. Go to Project Settings > Script Properties
 * 5. Add property: GITHUB_PAT = your GitHub Personal Access Token
 * 6. Save and refresh your sheet to see the "Filmland" menu
 */

/**
 * Creates custom menu when sheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Filmland')
    .addItem('Update Website', 'updateWebsite')
    .addItem('Find Missing Phone Numbers', 'findMissingPhoneNumbers')
    .addItem('Find Missing Websites', 'findMissingWebsites')
    .addItem('Add Crimson Cask (CC)', 'markCrimsonCask')
    .addItem('Apply KY Update (May 2026)', 'applyKentuckyUpdate')
    // .addItem('Fix Corporate Addresses', 'fixCorporateAddresses')
    .addToUi();
}

/**
 * One-button update: geocodes new stores, then pushes to GitHub
 */
function updateWebsite() {
  // Step 1: Normalize any new addresses
  normalizeAddresses();

  // Step 2: Geocode any new stores
  const geocodeResult = geocodeNewStores();

  // Step 3: Push to GitHub
  triggerGitHubSync(geocodeResult);
}

/**
 * Normalizes addresses using Google's geocoder.
 * Writes back the formatted address, city, state, zip from Google.
 * Skips rows where the "normalized" column is already TRUE.
 * Sets "normalized" to TRUE after processing.
 * Run once on existing data, then only new rows get normalized.
 */
function normalizeAddresses() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];

  const addressCol = headers.indexOf('address');
  const cityCol = headers.indexOf('city');
  const stateCol = headers.indexOf('state');
  const zipCol = headers.indexOf('zip');
  let normalizedCol = headers.indexOf('normalized');

  if (addressCol === -1 || cityCol === -1 || stateCol === -1) {
    SpreadsheetApp.getUi().alert('Error: Required columns not found (address, city, state).');
    return;
  }

  // Add "normalized" column if it doesn't exist
  if (normalizedCol === -1) {
    normalizedCol = headers.length;
    sheet.getRange(1, normalizedCol + 1).setValue('normalized');
  }

  let count = 0;
  let errorCount = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    // Skip already normalized rows
    if (row[normalizedCol] === true || row[normalizedCol] === 'TRUE' || row[normalizedCol] === true) {
      continue;
    }

    const address = row[addressCol];
    const city = row[cityCol];
    const state = row[stateCol];
    const zip = row[zipCol];

    if (!address || !city || !state) continue;

    const fullAddress = `${address}, ${city}, ${state}${zip ? ' ' + zip : ''}`;

    try {
      const geocoder = Maps.newGeocoder();
      const result = geocoder.geocode(fullAddress);

      if (result.results && result.results.length > 0) {
        const r = result.results[0];
        const components = r.address_components;

        // Extract normalized parts
        let newAddress = '';
        let newCity = '';
        let newState = '';
        let newZip = '';

        for (const c of components) {
          if (c.types.includes('street_number')) {
            newAddress = c.long_name;
          } else if (c.types.includes('route')) {
            newAddress += (newAddress ? ' ' : '') + c.long_name;
          } else if (c.types.includes('subpremise')) {
            newAddress += ' ' + c.long_name;
          } else if (c.types.includes('locality')) {
            newCity = c.long_name;
          } else if (c.types.includes('administrative_area_level_1')) {
            newState = c.short_name;
          } else if (c.types.includes('postal_code')) {
            newZip = c.long_name;
          }
        }

        // Only overwrite if we got a valid address back
        if (newAddress) {
          sheet.getRange(i + 1, addressCol + 1).setValue(newAddress);
        }
        if (newCity) {
          sheet.getRange(i + 1, cityCol + 1).setValue(newCity);
        }
        if (newState) {
          sheet.getRange(i + 1, stateCol + 1).setValue(newState);
        }
        if (newZip && zipCol !== -1) {
          sheet.getRange(i + 1, zipCol + 1).setValue(newZip);
        }

        // Mark as normalized
        sheet.getRange(i + 1, normalizedCol + 1).setValue(true);
        count++;
        Logger.log(`Row ${i + 1}: Normalized "${fullAddress}" → "${newAddress}, ${newCity}, ${newState} ${newZip}"`);
      } else {
        Logger.log(`Row ${i + 1}: No results for "${fullAddress}"`);
        errorCount++;
      }

      Utilities.sleep(200);
    } catch (error) {
      Logger.log(`Row ${i + 1}: Error: ${error}`);
      errorCount++;
    }
  }

  SpreadsheetApp.getUi().alert(
    `Address Normalization Complete\n\n` +
    `Normalized: ${count} addresses\n` +
    `Errors: ${errorCount}\n\n` +
    `Check logs for details.`
  );
}

/**
 * Geocodes stores that are missing lat/lng coordinates
 */
function geocodeNewStores() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();

  // Assuming first row is header
  const headers = values[0];

  // Find column indices
  const addressCol = headers.indexOf('address');
  const cityCol = headers.indexOf('city');
  const stateCol = headers.indexOf('state');
  const zipCol = headers.indexOf('zip');
  const latCol = headers.indexOf('lat');
  const lngCol = headers.indexOf('lng');

  if (addressCol === -1 || cityCol === -1 || stateCol === -1 || latCol === -1 || lngCol === -1) {
    SpreadsheetApp.getUi().alert('Error: Required columns not found. Ensure you have: address, city, state, zip, lat, lng');
    return;
  }

  let geocodedCount = 0;
  let errorCount = 0;

  // Start from row 2 (skip header)
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const lat = row[latCol];
    const lng = row[lngCol];

    // Skip if already has coordinates
    if (lat && lng && lat !== '' && lng !== '') {
      continue;
    }

    // Build full address
    const address = row[addressCol];
    const city = row[cityCol];
    const state = row[stateCol];
    const zip = row[zipCol];

    if (!address || !city || !state) {
      Logger.log(`Row ${i + 1}: Missing address components, skipping`);
      continue;
    }

    const fullAddress = `${address}, ${city}, ${state}${zip ? ' ' + zip : ''}`;

    try {
      // Geocode using Google Maps API
      const geocoder = Maps.newGeocoder();
      const result = geocoder.geocode(fullAddress);

      if (result.results && result.results.length > 0) {
        const location = result.results[0].geometry.location;

        // Update lat/lng in sheet (row index is i + 1 for 1-based indexing)
        sheet.getRange(i + 1, latCol + 1).setValue(location.lat);
        sheet.getRange(i + 1, lngCol + 1).setValue(location.lng);

        geocodedCount++;
        Logger.log(`Row ${i + 1}: Geocoded ${fullAddress} → (${location.lat}, ${location.lng})`);
      } else {
        Logger.log(`Row ${i + 1}: No results for ${fullAddress}`);
        errorCount++;
      }

      // Add small delay to avoid rate limiting
      Utilities.sleep(200);

    } catch (error) {
      Logger.log(`Row ${i + 1}: Error geocoding ${fullAddress}: ${error}`);
      errorCount++;
    }
  }

  return { geocodedCount, errorCount };
}

/**
 * Triggers GitHub Action to sync store data
 */
function triggerGitHubSync(geocodeResult) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const githubPat = scriptProperties.getProperty('GITHUB_PAT');

  if (!githubPat) {
    SpreadsheetApp.getUi().alert(
      'Error: GitHub PAT not configured.\n\n' +
      'Please add GITHUB_PAT to Script Properties:\n' +
      '1. Go to Project Settings\n' +
      '2. Add Script Property: GITHUB_PAT = your_token'
    );
    return;
  }

  const url = 'https://api.github.com/repos/troy-filmland/filmland-store-locator/actions/workflows/sync-stores.yml/dispatches';

  const options = {
    method: 'post',
    headers: {
      'Authorization': `Bearer ${githubPat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    contentType: 'application/json',
    payload: JSON.stringify({
      ref: 'main'
    }),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 204) {
      let msg = 'Website update started!\n\n';
      if (geocodeResult) {
        msg += `Geocoded: ${geocodeResult.geocodedCount} new stores\n`;
        if (geocodeResult.errorCount > 0) {
          msg += `Geocode errors: ${geocodeResult.errorCount}\n`;
        }
        msg += '\n';
      }
      msg += 'Store data will be live within a few minutes.';
      SpreadsheetApp.getUi().alert(msg);
    } else {
      Logger.log(`Response: ${response.getContentText()}`);
      SpreadsheetApp.getUi().alert(
        `Error triggering GitHub Action.\n\n` +
        `Status: ${statusCode}\n` +
        `Check the logs for details.`
      );
    }
  } catch (error) {
    Logger.log(`Error: ${error}`);
    SpreadsheetApp.getUi().alert(
      `Error triggering GitHub Action:\n\n${error}\n\n` +
      `Check the logs for details.`
    );
  }
}

/**
 * Finds phone numbers for stores that are missing them.
 * Uses Google Places API (New) Text Search via UrlFetchApp.
 * Requires PLACES_API_KEY in Script Properties.
 */
function findMissingPhoneNumbers() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('PLACES_API_KEY');

  if (!apiKey) {
    SpreadsheetApp.getUi().alert(
      'Error: PLACES_API_KEY not configured.\n\n' +
      'Please add PLACES_API_KEY to Script Properties:\n' +
      '1. Go to Project Settings\n' +
      '2. Add Script Property: PLACES_API_KEY = your_key'
    );
    return;
  }

  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];

  const nameCol = headers.indexOf('store_name');
  const addressCol = headers.indexOf('address');
  const cityCol = headers.indexOf('city');
  const stateCol = headers.indexOf('state');
  const phoneCol = headers.indexOf('phone');

  if (nameCol === -1 || addressCol === -1 || cityCol === -1 || stateCol === -1 || phoneCol === -1) {
    SpreadsheetApp.getUi().alert('Error: Required columns not found (store_name, address, city, state, phone).');
    return;
  }

  let foundCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;
  const results = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const phone = String(row[phoneCol] || '').trim();

    // Skip rows that already have a phone number
    if (phone && phone !== '0' && phone !== '1') continue;

    const storeName = String(row[nameCol] || '').trim();
    const address = String(row[addressCol] || '').trim();
    const city = String(row[cityCol] || '').trim();
    const state = String(row[stateCol] || '').trim();

    if (!storeName || !city) continue;

    const query = `${storeName}, ${address}, ${city}, ${state}`;

    try {
      const url = 'https://places.googleapis.com/v1/places:searchText';
      const payload = {
        textQuery: query,
        maxResultCount: 1
      };
      const options = {
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.nationalPhoneNumber,places.displayName'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();

      if (statusCode === 200) {
        const data = JSON.parse(response.getContentText());

        if (data.places && data.places.length > 0 && data.places[0].nationalPhoneNumber) {
          const newPhone = data.places[0].nationalPhoneNumber;
          sheet.getRange(i + 1, phoneCol + 1).setValue(newPhone);
          foundCount++;
          results.push(`Row ${i + 1}: ${storeName} → ${newPhone}`);
          Logger.log(`Row ${i + 1}: Found phone for "${storeName}": ${newPhone}`);
        } else {
          notFoundCount++;
          Logger.log(`Row ${i + 1}: No phone found for "${storeName}"`);
        }
      } else {
        errorCount++;
        Logger.log(`Row ${i + 1}: API error ${statusCode} for "${storeName}": ${response.getContentText()}`);
      }

      Utilities.sleep(200);
    } catch (error) {
      errorCount++;
      Logger.log(`Row ${i + 1}: Error for "${storeName}": ${error}`);
    }
  }

  let msg = `Find Missing Phone Numbers Complete\n\n`;
  msg += `Found: ${foundCount}\n`;
  msg += `Not found: ${notFoundCount}\n`;
  msg += `Errors: ${errorCount}\n`;
  if (foundCount > 0) {
    msg += `\nUpdated stores:\n`;
    results.forEach(r => { msg += r + '\n'; });
  }

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Finds websites for stores that are missing them.
 * Uses Google Places API (New) Text Search via UrlFetchApp.
 * Requires PLACES_API_KEY in Script Properties.
 */
function findMissingWebsites() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('PLACES_API_KEY');

  if (!apiKey) {
    SpreadsheetApp.getUi().alert(
      'Error: PLACES_API_KEY not configured.\n\n' +
      'Please add PLACES_API_KEY to Script Properties:\n' +
      '1. Go to Project Settings\n' +
      '2. Add Script Property: PLACES_API_KEY = your_key'
    );
    return;
  }

  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];

  const nameCol = headers.indexOf('store_name');
  const addressCol = headers.indexOf('address');
  const cityCol = headers.indexOf('city');
  const stateCol = headers.indexOf('state');
  let websiteCol = headers.indexOf('website');

  if (nameCol === -1 || addressCol === -1 || cityCol === -1 || stateCol === -1) {
    SpreadsheetApp.getUi().alert('Error: Required columns not found (store_name, address, city, state).');
    return;
  }

  // Add "website" column if it doesn't exist
  if (websiteCol === -1) {
    websiteCol = headers.length;
    sheet.getRange(1, websiteCol + 1).setValue('website');
  }

  let foundCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;
  const results = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const website = String(row[websiteCol] || '').trim();

    // Skip rows that already have a website
    if (website) continue;

    const storeName = String(row[nameCol] || '').trim();
    const address = String(row[addressCol] || '').trim();
    const city = String(row[cityCol] || '').trim();
    const state = String(row[stateCol] || '').trim();

    if (!storeName || !city) continue;

    const query = `${storeName}, ${address}, ${city}, ${state}`;

    try {
      const url = 'https://places.googleapis.com/v1/places:searchText';
      const payload = {
        textQuery: query,
        maxResultCount: 1
      };
      const options = {
        method: 'post',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.websiteUri,places.displayName'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();

      if (statusCode === 200) {
        const data = JSON.parse(response.getContentText());

        if (data.places && data.places.length > 0 && data.places[0].websiteUri) {
          const newWebsite = data.places[0].websiteUri;
          sheet.getRange(i + 1, websiteCol + 1).setValue(newWebsite);
          foundCount++;
          results.push(`Row ${i + 1}: ${storeName} → ${newWebsite}`);
          Logger.log(`Row ${i + 1}: Found website for "${storeName}": ${newWebsite}`);
        } else {
          notFoundCount++;
          Logger.log(`Row ${i + 1}: No website found for "${storeName}"`);
        }
      } else {
        errorCount++;
        Logger.log(`Row ${i + 1}: API error ${statusCode} for "${storeName}": ${response.getContentText()}`);
      }

      Utilities.sleep(200);
    } catch (error) {
      errorCount++;
      Logger.log(`Row ${i + 1}: Error for "${storeName}": ${error}`);
    }
  }

  let msg = `Find Missing Websites Complete\n\n`;
  msg += `Found: ${foundCount}\n`;
  msg += `Not found: ${notFoundCount}\n`;
  msg += `Errors: ${errorCount}\n`;
  if (foundCount > 0) {
    msg += `\nUpdated stores:\n`;
    results.forEach(r => { msg += r + '\n'; });
  }

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Finds real street addresses for stores that have corporate/LLC names
 * instead of street addresses. Uses Google Places text search.
 * Skips rows that already have a numeric street address.
 * Only updates address, city, state, zip — does NOT touch lat/lng or normalized.
 * After running this, run "Update Website" to re-normalize and re-geocode.
 */
function fixCorporateAddresses() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];

  const nameCol = headers.indexOf('store_name');
  const addressCol = headers.indexOf('address');
  const cityCol = headers.indexOf('city');
  const stateCol = headers.indexOf('state');
  const zipCol = headers.indexOf('zip');
  const latCol = headers.indexOf('lat');
  const lngCol = headers.indexOf('lng');
  const normalizedCol = headers.indexOf('normalized');

  if (nameCol === -1 || addressCol === -1 || cityCol === -1 || stateCol === -1) {
    SpreadsheetApp.getUi().alert('Error: Required columns not found.');
    return;
  }

  let fixedCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const results = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const address = String(row[addressCol] || '').trim();

    // Skip rows that already have a real street address (starts with a number)
    if (/^\d/.test(address)) {
      continue;
    }

    // Skip empty or placeholder addresses
    if (!address || address === '.' || address === 'Total') {
      continue;
    }

    // Check if address looks corporate (contains LLC, Inc, etc. with no street number)
    const addrLower = address.toLowerCase();
    if (!(addrLower.includes('llc') || addrLower.includes('inc') || addrLower.includes('partnership'))) {
      continue;
    }

    const storeName = String(row[nameCol] || '').trim();
    const city = String(row[cityCol] || '').trim();
    const state = String(row[stateCol] || '').trim();

    if (!storeName || !city) continue;

    // Search Google Places for the real address
    const query = `${storeName}, ${city}, ${state}`;

    try {
      const geocoder = Maps.newGeocoder();
      const result = geocoder.geocode(query);

      if (result.results && result.results.length > 0) {
        const r = result.results[0];
        const components = r.address_components;

        let newAddress = '';
        let newCity = '';
        let newState = '';
        let newZip = '';

        for (const c of components) {
          if (c.types.includes('street_number')) {
            newAddress = c.long_name;
          } else if (c.types.includes('route')) {
            newAddress += (newAddress ? ' ' : '') + c.long_name;
          } else if (c.types.includes('subpremise')) {
            newAddress += ' ' + c.long_name;
          } else if (c.types.includes('locality')) {
            newCity = c.long_name;
          } else if (c.types.includes('administrative_area_level_1')) {
            newState = c.short_name;
          } else if (c.types.includes('postal_code')) {
            newZip = c.long_name;
          }
        }

        // Only update if we got a real street address back (starts with a number)
        if (newAddress && /^\d/.test(newAddress)) {
          sheet.getRange(i + 1, addressCol + 1).setValue(newAddress);
          if (newCity) sheet.getRange(i + 1, cityCol + 1).setValue(newCity);
          if (newState) sheet.getRange(i + 1, stateCol + 1).setValue(newState);
          if (newZip && zipCol !== -1) sheet.getRange(i + 1, zipCol + 1).setValue(newZip);

          // Clear lat/lng so they get re-geocoded on next Update Website
          if (latCol !== -1) sheet.getRange(i + 1, latCol + 1).setValue('');
          if (lngCol !== -1) sheet.getRange(i + 1, lngCol + 1).setValue('');

          // Clear normalized flag so it gets re-normalized
          if (normalizedCol !== -1) sheet.getRange(i + 1, normalizedCol + 1).setValue('');

          fixedCount++;
          results.push(`Row ${i + 1}: ${storeName} → ${newAddress}, ${newCity}, ${newState} ${newZip}`);
          Logger.log(`Row ${i + 1}: Fixed "${storeName}" → "${newAddress}, ${newCity}, ${newState} ${newZip}"`);
        } else {
          skipCount++;
          Logger.log(`Row ${i + 1}: "${storeName}" — Places returned "${newAddress}" (not a street address), skipping`);
        }
      } else {
        skipCount++;
        Logger.log(`Row ${i + 1}: "${storeName}" — no Places results`);
      }

      Utilities.sleep(200);
    } catch (error) {
      errorCount++;
      Logger.log(`Row ${i + 1}: Error for "${storeName}": ${error}`);
    }
  }

  let msg = `Fix Corporate Addresses Complete\n\n`;
  msg += `Fixed: ${fixedCount}\n`;
  msg += `Could not resolve: ${skipCount}\n`;
  msg += `Errors: ${errorCount}\n\n`;
  if (fixedCount > 0) {
    msg += `Run "Update Website" next to re-normalize and re-geocode the fixed rows.\n\n`;
    msg += `Fixed stores:\n`;
    results.forEach(r => { msg += r + '\n'; });
  }
  if (skipCount > 0) {
    msg += `\nCheck the logs for stores that couldn't be resolved — you may need to look those up manually.`;
  }

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * One-time: adds a "CC" (The Crimson Cask) product column if missing,
 * then sets CC = TRUE on the stores that carry it, matched by street
 * address + zip. Any target that can't be found is reported so a bad
 * address can be fixed. Re-runnable: it only sets TRUE, never clears.
 *
 * After running this, run "Update Website" to push to the site.
 */
function markCrimsonCask() {
  // Targets: street address + zip. Matched against the sheet, NOT inserted.
  // Labels are just for the report.
  const CC_STORES = [
    { label: 'Liquor Barn Springhurst #980',        address: '4131 Towne Center Drive',        zip: '40241' },
    { label: 'Liquor Barn Richmond Road #904',       address: '3040 Richmond Road',             zip: '40509' },
    { label: 'Liquor Barn Middletown Commons #962',  address: '13401 Shelbyville Road',         zip: '40223' },
    { label: 'Liquor Barn Jefferson Commons #961',   address: '4901 Outer Loop',                zip: '40219' },
    { label: 'Liquor Barn Hurstbourne #960',         address: '1850 South Hurstbourne Parkway', zip: '40220' },
    { label: 'Liquor Barn Hamburg #920',             address: '1837 Plaudit Place',             zip: '40509' },
    { label: 'Liquor Barn Fern Valley #970',         address: '3420 Fern Valley Road',          zip: '40213' },
    { label: 'Liquor Barn Elizabethtown #986',       address: '1705 North Dixie Highway',       zip: '42701' },
    { label: 'Liquor Barn Beaumont #903',            address: '921 Beaumont Centre Parkway',    zip: '40513' },
    { label: 'Party Mart Brownsboro Road #901',      address: '4808 Brownsboro Road',           zip: '40207' },
    { label: 'Liquor Barn Fort Thomas #908',         address: '424 Alexandria Pike',            zip: '41075' },
  ];

  // Normalize an address for comparison: lowercase, strip punctuation,
  // collapse whitespace. "4131 Towne Center Dr." == "4131 Towne Center Dr"
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sheet = SpreadsheetApp.getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues();
  const headers = values[0];

  const addressCol = headers.indexOf('address');
  const zipCol = headers.indexOf('zip');
  const nameCol = headers.indexOf('store_name');

  if (addressCol === -1 || zipCol === -1) {
    SpreadsheetApp.getUi().alert('Error: Required columns not found (address, zip).');
    return;
  }

  // Find or create the CC column. Reuse a blank header column if one exists
  // (keeps it next to the other product columns); otherwise append.
  let ccCol = headers.indexOf('CC');
  if (ccCol === -1) {
    // Append a fresh column at the end. Do NOT reuse a blank-header column —
    // this sheet has a stray blank column already full of TRUE values, and
    // reusing it would mark every store as carrying CC.
    ccCol = headers.length;
    sheet.getRange(1, ccCol + 1).setValue('CC');
  }

  // Make the CC column checkboxes and reset EVERY row to unchecked (FALSE)
  // first, so only the matched rows below end up TRUE. Safe to re-run.
  const numDataRows = values.length - 1;
  if (numDataRows > 0) {
    const ccRange = sheet.getRange(2, ccCol + 1, numDataRows, 1);
    ccRange.insertCheckboxes();
    ccRange.uncheck();
  }

  // Build a lookup of normalized "address|zip" -> [row indices]
  const matchedRows = {};      // target index -> array of {row, name}
  CC_STORES.forEach((_, idx) => { matchedRows[idx] = []; });

  for (let i = 1; i < values.length; i++) {
    const rowAddr = norm(values[i][addressCol]);
    const rowZip = String(values[i][zipCol] || '').trim();
    if (!rowAddr) continue;

    for (let t = 0; t < CC_STORES.length; t++) {
      const target = CC_STORES[t];
      if (rowAddr === norm(target.address) && rowZip === target.zip) {
        matchedRows[t].push({ row: i + 1, name: String(values[i][nameCol] || '') });
      }
    }
  }

  // Set CC = TRUE on every matched row
  let setCount = 0;
  const found = [];
  const notFound = [];
  const dupes = [];

  for (let t = 0; t < CC_STORES.length; t++) {
    const hits = matchedRows[t];
    if (hits.length === 0) {
      notFound.push(CC_STORES[t]);
      continue;
    }
    if (hits.length > 1) {
      dupes.push({ target: CC_STORES[t], hits });
    }
    hits.forEach(hit => {
      sheet.getRange(hit.row, ccCol + 1).setValue(true);
      setCount++;
      found.push(`Row ${hit.row}: ${hit.name} (${CC_STORES[t].label})`);
    });
  }

  let msg = 'Add Crimson Cask (CC) Complete\n\n';
  msg += `CC set TRUE on: ${setCount} row(s)\n`;
  msg += `Targets matched: ${CC_STORES.length - notFound.length} of ${CC_STORES.length}\n\n`;

  if (found.length > 0) {
    msg += 'Matched stores:\n';
    found.forEach(f => { msg += '  ' + f + '\n'; });
    msg += '\n';
  }

  if (notFound.length > 0) {
    msg += `NOT FOUND (${notFound.length}) — fix the address/zip below, then re-run:\n`;
    notFound.forEach(n => { msg += `  ${n.label} — ${n.address}, ${n.zip}\n`; });
    msg += '\n';
  }

  if (dupes.length > 0) {
    msg += `Matched MULTIPLE rows (verify these are correct):\n`;
    dupes.forEach(d => {
      msg += `  ${d.target.label}: ${d.hits.map(h => 'row ' + h.row).join(', ')}\n`;
    });
    msg += '\n';
  }

  if (notFound.length === 0) {
    msg += 'All targets matched. Run "Update Website" to push to the site.';
  }

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * One-time: applies the May 2026 Kentucky rolling-report update.
 *  - Adds SKUs to existing stores (matched by exact address + zip; only sets
 *    TRUE, never clears).
 *  - Appends new stores with blank lat/lng so "Update Website" geocodes them.
 * Re-runnable: existing-store SKUs are idempotent, and new stores are skipped
 * if an identical address already exists.
 *
 * After running this, run "Update Website" to normalize, geocode, and push.
 */
function applyKentuckyUpdate() {
  // Existing rows: match by the sheet's own address + zip, then add these SKUs.
  const SKU_UPDATES = [
    { address: '4131 Towne Center Drive', zip: '40241', add: ['MMEC'] },        // Liquor Barn #980
    { address: '107 East Flaget Street',  zip: '40004', add: ['CC'] },          // The Volstead
    { address: '127 North 3rd Street',    zip: '40004', add: ['MM'] },          // Cox's Evergreen #41
    { address: '720 East Market Street',  zip: '40202', add: ['MM', 'QUAD'] },  // Evergreen Liquors NULU
  ];

  // New stores. zip left blank on purpose — "Update Website" geocodes/normalizes
  // and fills city/state/zip + lat/lng. products = abbreviations to set TRUE.
  const NEW_STORES = [
    { store_name: 'The Barrel Market',           address: '110 Summit at Fritz Farm', city: 'Lexington',    state: 'KY', type: 'Off-Premise', products: ['CC'] },
    { store_name: 'Taste Fine Wine & Spirits',   address: '634 East Market Street',   city: 'Louisville',   state: 'KY', type: 'Off-Premise', products: ['CC'] },
    { store_name: 'Oak & Grape',                 address: '118 North 3rd Street',     city: 'Bardstown',    state: 'KY', type: 'On-Premise',  products: ['CC'] },
    { store_name: 'Liquor Junction',             address: '11304 Maple Brook Drive',  city: 'Louisville',   state: 'KY', type: 'Off-Premise', products: ['MM', 'MMEC'] },
    { store_name: 'Liquor Palate #2',            address: '3707 Chamberlain Lane',    city: 'Louisville',   state: 'KY', type: 'Off-Premise', products: ['MMEC', 'MMWP', 'QUAD'] },
    { store_name: 'Great Spirits 23',            address: '608 Richmond Road North',  city: 'Berea',        state: 'KY', type: 'Off-Premise', products: ['RREC'] },
    { store_name: 'Bourbon CO Whiskey House',    address: '616 Main Street',          city: 'Paris',        state: 'KY', type: 'On-Premise',  products: ['MM', 'MMEC', 'RR', 'RREC'] },
    { store_name: 'Noble Funk Brewing Co',       address: '922 South 2nd Street',     city: 'Louisville',   state: 'KY', type: 'On-Premise',  products: ['MMEC', 'MMWP', 'QUAD', 'RREC'] },
    { store_name: 'Bourbon on Rye',              address: '115 West Main Street',     city: 'Lexington',    state: 'KY', type: 'On-Premise',  products: ['MMWP'] },
  ];

  const PRODUCT_COLS = ['MM', 'MMEC', 'RR', 'RREC', 'QUAD', 'MMWP', 'CC'];

  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sheet = SpreadsheetApp.getActiveSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];

  const col = {};
  ['store_name', 'address', 'city', 'state', 'zip', 'phone', 'website', 'type', 'lat', 'lng', 'normalized']
    .concat(PRODUCT_COLS)
    .forEach(h => { col[h] = headers.indexOf(h); });

  if (col.address === -1 || col.zip === -1 || col.store_name === -1) {
    SpreadsheetApp.getUi().alert('Error: required columns (store_name, address, zip) not found.');
    return;
  }
  // Every product column must exist (CC was added by markCrimsonCask).
  for (const p of PRODUCT_COLS) {
    if (col[p] === -1) {
      SpreadsheetApp.getUi().alert('Error: product column "' + p + '" not found. Run "Add Crimson Cask (CC)" first if CC is missing.');
      return;
    }
  }

  const report = [];

  // --- 1. SKU updates on existing rows ---
  const skuFound = [];
  const skuMissing = [];
  for (const upd of SKU_UPDATES) {
    let matchedRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (norm(values[i][col.address]) === norm(upd.address) &&
          String(values[i][col.zip]).trim() === upd.zip) {
        matchedRow = i + 1;
        break;
      }
    }
    if (matchedRow === -1) {
      skuMissing.push(`${upd.address} (${upd.zip}) — add [${upd.add.join(',')}]`);
      continue;
    }
    upd.add.forEach(p => sheet.getRange(matchedRow, col[p] + 1).setValue(true));
    skuFound.push(`Row ${matchedRow}: ${values[matchedRow - 1][col.store_name]} += [${upd.add.join(',')}]`);
  }

  // --- 2. New stores. Match by address + STATE (address strings repeat across
  // states, so address-only matching is unsafe). If the store already exists,
  // just add its SKUs; otherwise append a new row. ---
  const added = [];
  const matchedExisting = [];
  for (const ns of NEW_STORES) {
    let matchedRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (norm(values[i][col.address]) === norm(ns.address) &&
          String(values[i][col.state]).trim().toUpperCase() === ns.state.toUpperCase()) {
        matchedRow = i + 1;
        break;
      }
    }

    if (matchedRow !== -1) {
      ns.products.forEach(p => sheet.getRange(matchedRow, col[p] + 1).setValue(true));
      matchedExisting.push(`Row ${matchedRow}: ${values[matchedRow - 1][col.store_name]} (already on sheet at ${ns.address}) += [${ns.products.join(',')}]`);
      continue;
    }

    const row = new Array(headers.length).fill('');
    row[col.store_name] = ns.store_name;
    row[col.address] = ns.address;
    row[col.city] = ns.city;
    row[col.state] = ns.state;
    row[col.type] = ns.type;
    // products: TRUE for carried, FALSE otherwise
    PRODUCT_COLS.forEach(p => { row[col[p]] = ns.products.indexOf(p) !== -1; });
    // lat/lng/zip/normalized left blank so Update Website geocodes + normalizes.

    sheet.appendRow(row);
    added.push(`${ns.store_name} — ${ns.address}, ${ns.city} [${ns.products.join(',')}]`);
  }

  // Render product columns as checkboxes for the newly appended rows.
  if (added.length > 0) {
    const lastRow = sheet.getLastRow();
    const firstNew = lastRow - added.length + 1;
    const minProdCol = Math.min.apply(null, PRODUCT_COLS.map(p => col[p]));
    const maxProdCol = Math.max.apply(null, PRODUCT_COLS.map(p => col[p]));
    sheet.getRange(firstNew, minProdCol + 1, added.length, maxProdCol - minProdCol + 1).insertCheckboxes();
  }

  // --- report ---
  let msg = 'Apply KY Update Complete\n\n';
  msg += `SKUs added to existing stores: ${skuFound.length}\n`;
  skuFound.forEach(s => { msg += '  ' + s + '\n'; });
  if (skuMissing.length > 0) {
    msg += `\nSKU targets NOT FOUND (${skuMissing.length}):\n`;
    skuMissing.forEach(s => { msg += '  ' + s + '\n'; });
  }
  msg += `\nNew stores added: ${added.length}\n`;
  added.forEach(s => { msg += '  ' + s + '\n'; });
  if (matchedExisting.length > 0) {
    msg += `\nAlready on sheet — SKUs added instead (${matchedExisting.length}):\n`;
    matchedExisting.forEach(s => { msg += '  ' + s + '\n'; });
  }
  msg += '\nRun "Update Website" next to geocode the new stores and push to the site.';

  SpreadsheetApp.getUi().alert(msg);
}
