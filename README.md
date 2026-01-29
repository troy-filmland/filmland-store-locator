# Filmland Store Locator

Production-ready store locator for Filmland Spirits using Google Maps API and GitHub Pages.

## Setup Instructions

### 1. Initial Setup

```bash
# Install dependencies
npm install

# Run the data pivot script to create initial import file
npm run pivot
```

This creates `data/initial-import.csv` from your raw sales data.

### 2. Import to Google Sheets

1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1SCloGVtzpw14z2zcTEuV18teTNMpUmtoL1EKwEBHyYY/edit
2. Import the `data/initial-import.csv` file
3. Verify the columns match: `store_name,address,city,state,zip,phone,type,lat,lng,products`

### 3. Setup Google Apps Script

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code
3. Paste the code from `scripts/geocode-apps-script.js`
4. Save the project (name it "Filmland Store Locator")
5. Go to **Project Settings** (gear icon)
6. Add a Script Property:
   - Key: `GITHUB_PAT`
   - Value: Your GitHub Personal Access Token (with `repo` scope)
7. Refresh your Google Sheet - you should see a "Filmland" menu appear

### 4. Geocode Stores

1. In Google Sheet, click **Filmland > Geocode New Stores**
2. Authorize the script when prompted
3. Wait for geocoding to complete (it will show progress)
4. Verify lat/lng columns are populated

### 5. Publish Google Sheet as CSV

1. In Google Sheet, go to **File > Share > Publish to web**
2. Select the sheet tab with your store data
3. Choose **Comma-separated values (.csv)** format
4. Click **Publish**
5. Copy the published CSV URL

### 6. Configure GitHub Secrets

1. Go to your GitHub repo: https://github.com/troy-filmland/filmland-store-locator
2. Go to **Settings > Secrets and variables > Actions**
3. Add repository secret:
   - Name: `SHEET_CSV_URL`
   - Value: Your published CSV URL from step 5

### 7. Enable GitHub Pages

1. Go to **Settings > Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** / **root**
4. Save

### 8. Test the Sync

In Google Sheet, click **Filmland > Push Update Now** to trigger the first sync.

Check the Actions tab in GitHub to see the workflow run: https://github.com/troy-filmland/filmland-store-locator/actions

After the workflow completes, your store data will be at:
- https://troy-filmland.github.io/filmland-store-locator/data/stores.json

### 9. Embed in Webflow

Copy the code from `src/store-locator-embed.html` and paste it into a Webflow custom code embed block.

## Development

### Local Testing

```bash
# Serve locally (use any static server)
cd src
python -m http.server 8000
# or
npx serve .
```

Open http://localhost:8000/index.html

### Manual Sync

```bash
# Set the environment variable
export SHEET_CSV_URL="your_published_csv_url"

# Run the fetch script
npm run fetch
```

## Architecture

- **Google Sheets**: Source of truth for store data
- **Google Apps Script**: Geocoding and manual sync trigger
- **GitHub Actions**: Automated nightly sync (3am UTC)
- **GitHub Pages**: Hosting for static files
- **Webflow**: Final embed location

## Files

- `src/app.js` - Main store locator application
- `src/styles.css` - Filmland brand styling
- `src/index.html` - Local development page
- `src/store-locator-embed.html` - Webflow embed code
- `scripts/fetch-sheet.js` - Fetches and processes Google Sheet data
- `scripts/geocode-apps-script.js` - Google Apps Script for geocoding
- `scripts/pivot-raw-data.js` - One-time data transformation script
- `.github/workflows/sync-stores.yml` - GitHub Action for automated sync
- `data/stores.json` - Generated store data (auto-updated)

## Support

For issues or questions, contact Troy at Filmland Spirits.