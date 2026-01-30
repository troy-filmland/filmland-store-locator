# Filmland Store Locator

## Project Structure
- `src/app.js` — All frontend logic (map, search, filters, markers). Served via GitHub Pages.
- `src/styles.css` — All styles. Served via GitHub Pages.
- `src/store-locator-embed.html` — HTML snippet that gets **manually copy-pasted** into Webflow. This is NOT auto-deployed. If you only change this file, do NOT push to git — the user copies it directly.
- `src/index.html` — Local dev page only. Not used in production.
- `scripts/pivot-raw-data.js` — One-time script to convert raw xlsx distributor data into CSV for Google Sheet import.
- `scripts/fetch-sheet.js` — Fetches published Google Sheet CSV, converts to stores.json. Run by GitHub Action.
- `scripts/geocode-apps-script.js` — Google Apps Script code (copy-pasted into Google Sheets Extensions > Apps Script). NOT deployed via git. User must manually update it in Google Sheets.
- `data/stores.json` — Store data. Auto-updated by GitHub Action. Fetched at runtime by app.js.
- `.github/workflows/sync-stores.yml` — Nightly sync + manual trigger from Google Sheets "Update Website" button.

## Cache Busting
The Webflow embed loads app.js and styles.css from GitHub Pages with a version query string:
```
styles.css?v=3
app.js?v=3
```
When you change app.js or styles.css, you MUST:
1. Update the `?v=N` parameter in `src/store-locator-embed.html` (increment the number)
2. Tell the user to re-paste the embed code into Webflow

`stores.json` has its own cache busting — app.js appends `?t=<timestamp>` at runtime, so data updates are always fresh.

## Deployment
- **app.js / styles.css changes**: Push to git → GitHub Pages auto-deploys → user must re-paste embed with bumped version if cache busting needed
- **store-locator-embed.html changes**: Do NOT push just for this. The user copies the file content directly into Webflow.
- **stores.json data updates**: Triggered by "Update Website" button in Google Sheets → GitHub Action runs fetch-sheet.js → commits updated stores.json → GitHub Pages serves it
- **geocode-apps-script.js changes**: Tell the user to copy the file contents into Extensions > Apps Script in Google Sheets. This is NOT auto-deployed.

## Google Maps API
- Uses PlaceAutocompleteElement (new web component, NOT legacy Autocomplete)
- Event name: `gmp-select` (NOT `gmp-placeselect`)
- Event gives `event.placePrediction` (NOT `event.place`)
- Must call `placePrediction.toPlace()` then `place.fetchFields({ fields: [...] })`
- `place.formattedAddress` gives full address with city/state. `place.displayName` gives only the short name.
- AdvancedMarkerElement requires a Map ID: `f819752469bfd00fc0ac5d17`
- API key is restricted by HTTP referrer

## Product System
6 products with abbreviated column headers in Google Sheet:

| Abbreviation | Full Name |
|---|---|
| MM | Moonlight Mayhem! |
| MMEC | Moonlight Mayhem! Extended Cut |
| RR | Ryes of the Robots |
| RREC | Ryes of the Robot Extended Cut |
| QUAD | Quadraforce Blended Bourbon |
| MMWP | Moonlight Mayhem! 2 the White Port Wolf |

"Mayhem" ALWAYS has an exclamation mark. "Town at the End of Tomorrow" is excluded (sold out).

The mapping is defined in BOTH `scripts/pivot-raw-data.js` and `scripts/fetch-sheet.js`. If products change, update both files.

## Type System
Data stores "Off-Premise" and "On-Premise". UI displays:
- Off-Premise → "Retail" (building icon marker)
- On-Premise → "Bars & Restaurants" (whiskey glass icon marker)

The label mapping is in `src/app.js` in the `TYPE_LABELS` object.

## Google Sheet
- Sheet ID: `1SCloGVtzpw14z2zcTEuV18teTNMpUmtoL1EKwEBHyYY`
- Published CSV URL is stored in GitHub secret `SHEET_CSV_URL`
- If the sheet structure changes (columns added/removed/renamed), the sheet must be re-published: File > Share > Publish to web > Stop publishing > Publish again
- The "Update Website" button (Filmland menu) geocodes new stores then triggers GitHub Action sync

## Common Mistakes to Avoid
- Do NOT use `gmp-placeselect` — it's the old event name. Use `gmp-select`.
- Do NOT use `event.place` — use `event.placePrediction.toPlace()`.
- Do NOT use `componentRestrictions` — use `includedRegionCodes`.
- Do NOT use `place.displayName` for the location label — it drops city/state. Use `place.formattedAddress`.
- Do NOT forget to commit app.js changes. Verify with `git diff --cached` before pushing.
- Do NOT assume GitHub Pages CDN updates instantly. Always bump the version parameter.
- Do NOT push just to update store-locator-embed.html — the user copies it manually.
- Do NOT change the Google Sheet column order or header names without re-publishing the sheet and updating both pivot and fetch scripts.
