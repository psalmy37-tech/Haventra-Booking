# Haventra viewing booking page

Static site (index.html, css/, js/, assets/) for GitHub Pages, plus a Google Apps Script backend (apps-script/).

## Setup (sign in as psalmy37@gmail.com for all steps)
1. Create a Google Sheet. Extensions > Apps Script. Paste apps-script/Code.gs. In Project Settings tick "Show appsscript.json" and paste apps-script/appsscript.json.
2. Run `setup` once and approve permissions. It builds the four tabs, Status dropdown, colours, frozen header, filter, settings, sample properties and the Today and Upcoming view.
3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the web app URL.
4. Paste the URL into APPS_SCRIPT_URL at the top of js/app.js. Replace the other placeholders in that block (WhatsApp, phone, email, address, social links).
5. Upload the files to a public GitHub repo and enable Pages (main branch, root). Run the test checklist on the live URL.

If you change code in Apps Script later: Deploy > Manage deployments > edit > New version. The URL stays the same.
