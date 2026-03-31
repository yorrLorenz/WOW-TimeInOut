/**
 * Google Sheets integration via Apps Script Web App.
 *
 * Setup:
 * 1. Create a Google Sheet.
 * 2. Extensions → Apps Script → paste apps-script/Code.gs.
 * 3. Deploy as Web App (Execute as: Me, Who has access: Anyone).
 * 4. Copy the Web App URL and save it in Admin → Settings.
 */

const STORAGE_KEY    = 'appsScriptUrl';
const STD_HOURS_KEY  = 'standardWorkHours';

export function getAppsScriptUrl()    { return localStorage.getItem(STORAGE_KEY)   ?? ''; }
export function saveAppsScriptUrl(url){ localStorage.setItem(STORAGE_KEY, url); }

export function getStandardHours()    { return Number(localStorage.getItem(STD_HOURS_KEY) ?? 8); }
export function saveStandardHours(h)  { localStorage.setItem(STD_HOURS_KEY, String(h)); }

/** Duration string from two ISO timestamps → "Xh Ym". */
export function calcDuration(timeIn, timeOut) {
  if (!timeIn || !timeOut) return '';
  const ms = new Date(timeOut) - new Date(timeIn);
  if (ms <= 0) return '';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/** Duration in decimal hours from two ISO timestamps. */
export function calcDurationHours(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const ms = new Date(timeOut) - new Date(timeIn);
  return ms > 0 ? ms / 3_600_000 : 0;
}

// ── Attendance logs ───────────────────────────────────────────────────────────

export async function pushLogToSheets(p) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'addLog', ...p }) });
  if (!res.ok) throw new Error(`Sheets sync failed: ${res.status}`);
  return res.json();
}

export async function updateLogInSheets(p) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'updateLog', ...p }) });
  if (!res.ok) throw new Error(`Sheets update failed: ${res.status}`);
  return res.json();
}

export async function bulkPushLogsToSheets(logs) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'bulkAddLogs', logs }) });
  if (!res.ok) throw new Error(`Bulk sync failed: ${res.status}`);
  return res.json();
}

// ── Employee sync (cross-branch face data) ────────────────────────────────────

/**
 * Push one employee + their face descriptors to the EmployeeSync sheet.
 * Called automatically after face registration.
 */
export async function upsertEmployeeToSheets(emp) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({
      action:      'upsertEmployee',
      uid:         emp.uid         || '',
      name:        emp.name        || '',
      position:    emp.position    || '',
      homeBranch:  emp.homeBranch  || '',
      descriptors: emp.descriptors || [],
    }),
  });
  if (!res.ok) throw new Error(`Employee upsert failed: ${res.status}`);
  return res.json();
}

/**
 * Pull all employees (with descriptors) from the EmployeeSync sheet.
 * Used to populate other branch kiosks with cross-branch face data.
 */
export async function fetchEmployeesFromSheets() {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const res = await fetch(`${url}?action=getEmployees`);
  if (!res.ok) throw new Error(`Employee fetch failed: ${res.status}`);
  const data = await res.json();
  return data.employees || [];
}

// ── Employee directory ────────────────────────────────────────────────────────

/**
 * Push all employees to the "Employees" sheet (full replace).
 * Face recognition data cannot be stored in a spreadsheet — stores status only.
 */
export async function bulkSyncEmployeesToSheets(employees) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const payload = employees.map((e) => ({
    uid:           e.uid || '',
    name:          e.name || '',
    position:      e.position || '',
    homeBranch:    e.homeBranch || '',
    faceRegistered: (e.descriptors?.length ?? 0) > 0,
    faceCount:     e.descriptors?.length ?? 0,
    createdAt:     e.createdAt || '',
  }));
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action: 'bulkSyncEmployees', employees: payload }),
  });
  if (!res.ok) throw new Error(`Employee sync failed: ${res.status}`);
  return res.json();
}

// ── Monthly Summary ───────────────────────────────────────────────────────────

/**
 * Returns an array of { label, year, month, half } for the last 12 half-month periods.
 * half = 1 → days 1–15, half = 2 → days 16–end.
 */
export function generatePeriodOptions() {
  const options = [];
  const now     = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth() + 1;        // 1-based
  let half  = now.getDate() <= 15 ? 1 : 2;

  for (let i = 0; i < 12; i++) {
    const mm    = String(month).padStart(2, '0');
    const label = half === 1
      ? `${year}-${mm} (1–15)`
      : `${year}-${mm} (16–end)`;
    options.push({ label, year, month, half });

    // Step back one half-month
    if (half === 2) {
      half = 1;
    } else {
      half = 2;
      month--;
      if (month < 1) { month = 12; year--; }
    }
  }
  return options;
}

/**
 * Compute per-employee summary for a specific half-month period.
 * @param {object[]} logs        - all logs from IndexedDB
 * @param {object[]} employees   - all employees from IndexedDB
 * @param {number}   year
 * @param {number}   month       - 1-based
 * @param {number}   half        - 1 = days 1-15, 2 = days 16-end
 * @param {number}   standardHours - hours/day to compare for overtime/undertime
 */
export function computePeriodSummary(logs, employees, year, month, half, standardHours = 8) {
  const empMap = {};
  for (const emp of employees) empMap[emp.id] = emp;

  const buckets = {};   // key = employeeId

  for (const log of logs) {
    if (!log.timeIn || !log.timeOut) continue;   // skip incomplete entries

    const d   = new Date(log.timeIn);
    const ly  = d.getFullYear();
    const lm  = d.getMonth() + 1;
    const ld  = d.getDate();
    const lh  = ld <= 15 ? 1 : 2;

    if (ly !== year || lm !== month || lh !== half) continue;

    const id = log.employeeId;
    if (!buckets[id]) {
      const emp = empMap[id];
      buckets[id] = {
        uid:          emp?.uid  || `#${id}`,
        name:         emp?.name || 'Unknown',
        branch:       log.branchIn || log.branchCode || '',
        workingDays:  0,
        totalMinutes: 0,
        overtimeDays: 0,
        undertimeDays: 0,
      };
    }

    const durationH = calcDurationHours(log.timeIn, log.timeOut);
    buckets[id].workingDays++;
    buckets[id].totalMinutes += durationH * 60;
    if (durationH > standardHours)             buckets[id].overtimeDays++;
    else if (durationH > 0)                    buckets[id].undertimeDays++;
  }

  return Object.values(buckets).map((b) => ({
    uid:          b.uid,
    name:         b.name,
    branch:       b.branch,
    workingDays:  b.workingDays,
    totalHours:   parseFloat((b.totalMinutes / 60).toFixed(2)),
    overtimeDays: b.overtimeDays,
    undertimeDays: b.undertimeDays,
  }));
}

/** Push a computed period summary to the "Monthly Summary" sheet. */
export async function generateMonthlySummaryToSheets(periodLabel, rows) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script URL not configured.');
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action: 'generateMonthlySummary', period: periodLabel, rows }),
  });
  if (!res.ok) throw new Error(`Monthly summary failed: ${res.status}`);
  return res.json();
}
