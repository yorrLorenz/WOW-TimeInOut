/**
 * Google Sheets integration via Apps Script Web App.
 *
 * Setup:
 * 1. Create a Google Sheet.
 * 2. Extensions → Apps Script → paste apps-script/Code.gs.
 * 3. Deploy as Web App (Execute as: Me, Who has access: Anyone).
 * 4. Copy the Web App URL and save it in Admin → Settings.
 *
 * Columns written: UID | Staff | Date | Time In | Time Out | Branch In | Branch Out | Duration
 */

const STORAGE_KEY = 'appsScriptUrl';

export function getAppsScriptUrl() {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function saveAppsScriptUrl(url) {
  localStorage.setItem(STORAGE_KEY, url);
}

/** Calculate duration string from two ISO timestamps. */
export function calcDuration(timeIn, timeOut) {
  if (!timeIn || !timeOut) return '';
  const ms = new Date(timeOut) - new Date(timeIn);
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/**
 * Push a single attendance log row to Google Sheets.
 * @param {object} p
 * @param {string} p.uid
 * @param {string} p.employeeName
 * @param {string} p.date
 * @param {string} p.timeIn
 * @param {string} p.timeOut
 * @param {string} p.branchIn
 * @param {string} p.branchOut
 * @param {string} p.duration
 */
export async function pushLogToSheets(p) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action: 'addLog', ...p }),
  });

  if (!response.ok) throw new Error(`Sheets sync failed: ${response.status}`);
  return response.json();
}

/**
 * Push all unsynchronised logs at once (bulk sync).
 */
export async function bulkPushLogsToSheets(logs) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action: 'bulkAddLogs', logs }),
  });

  if (!response.ok) throw new Error(`Bulk sync failed: ${response.status}`);
  return response.json();
}
