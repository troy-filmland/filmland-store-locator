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
