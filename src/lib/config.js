/**
 * App-wide configuration.
 *
 * APPS_SCRIPT_URL — paste your Google Apps Script Web App URL here.
 * To get the URL:
 *   1. Open apps-script/Code.gs in the Apps Script editor.
 *   2. Deploy → Manage deployments → copy the Web App URL.
 *   3. Paste it below, then rebuild the app (npm run build).
 *
 * The URL does NOT change when you redeploy a new version of the same
 * deployment. It only changes if you create a brand-new deployment.
 */
export const APPS_SCRIPT_URL = ' ';

/**
 * Shared secret token — must match APP_TOKEN in apps-script/Code.gs.
 * Any request missing this token is rejected by the Apps Script.
 * Change this to a unique value and update Code.gs to match.
 */
export const APPS_SCRIPT_TOKEN = 'wt-timein-2026';
