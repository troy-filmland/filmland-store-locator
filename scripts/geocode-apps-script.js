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
