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
  const ui = SpreadsheetApp.getUi();

  // Step 1: Geocode any new stores
  const geocodeResult = geocodeNewStores();

  // Step 2: Push to GitHub
  triggerGitHubSync(geocodeResult);
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
