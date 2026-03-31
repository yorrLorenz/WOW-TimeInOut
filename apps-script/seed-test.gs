/**
 * seed-test.gs  —  Run these functions from the Apps Script editor to populate
 * the EmployeeSync sheet with test employees (no face data).
 *
 * HOW TO USE:
 *   1. Open your Apps Script project (the one with Code.gs).
 *   2. Paste this file contents into a new tab (File → New → Script file → "seed-test").
 *   3. Select the function you want to run from the toolbar and click ▶ Run.
 *   4. Check the EmployeeSync sheet — rows should appear.
 *
 * After seeding Sheets, go to Admin → Settings → "Pull Employees from Sheets"
 * in the app.  Employees will appear locally with no face data so they can
 * register their faces at any kiosk.
 */

// ── Edit this list to match your real employees ───────────────────────────────
var TEST_EMPLOYEES = [
  { uid: 'EMP-0001', name: 'Alice Reyes',    position: 'Cashier',       homeBranch: 'MAIN-001'  },
  { uid: 'EMP-0002', name: 'Bob Santos',     position: 'Supervisor',    homeBranch: 'MAIN-001'  },
  { uid: 'EMP-0003', name: 'Carla Mendoza',  position: 'Staff',         homeBranch: 'NORTH-002' },
  { uid: 'EMP-0004', name: 'Dan Cruz',       position: 'Staff',         homeBranch: 'NORTH-002' },
  { uid: 'EMP-0005', name: 'Eva Lim',        position: 'Team Leader',   homeBranch: 'SOUTH-003' },
  { uid: 'EMP-0006', name: 'Felix Torres',   position: 'Cashier',       homeBranch: 'SOUTH-003' },
  { uid: 'EMP-0007', name: 'Grace Tan',      position: 'Staff',         homeBranch: 'MAIN-001'  },
  { uid: 'EMP-0008', name: 'Henry Uy',       position: 'Supervisor',    homeBranch: 'NORTH-002' },
];

/**
 * Seed all TEST_EMPLOYEES into the EmployeeSync sheet.
 * Skips any UID that already exists.
 */
function seedEmployeesToSyncSheet() {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var sheet     = ss.getSheetByName('EmployeeSync');

  // Create sheet if missing (same structure as Code.gs)
  if (!sheet) {
    sheet = ss.insertSheet('EmployeeSync');
    sheet.appendRow(['UID', 'Name', 'Position', 'Home Branch', 'Descriptors', 'Updated At']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.hideColumns(5);
    Logger.log('Created EmployeeSync sheet.');
  }

  // Build a set of existing UIDs
  var existingUIDs = {};
  var last = sheet.getLastRow();
  if (last > 1) {
    var uidCol = sheet.getRange(2, 1, last - 1, 1).getValues();
    uidCol.forEach(function(r) { if (r[0]) existingUIDs[String(r[0])] = true; });
  }

  var added = 0;
  var now   = new Date().toISOString();

  TEST_EMPLOYEES.forEach(function(emp) {
    if (existingUIDs[emp.uid]) {
      Logger.log('Skipping (already exists): ' + emp.uid + ' — ' + emp.name);
      return;
    }
    sheet.appendRow([
      emp.uid,
      emp.name,
      emp.position,
      emp.homeBranch,
      '',          // Descriptors — empty; employee will register face in the app
      now,
    ]);
    Logger.log('Added: ' + emp.uid + ' — ' + emp.name);
    added++;
  });

  Logger.log('Done. Added ' + added + ' employee(s).');
}

/**
 * Clear ALL rows from EmployeeSync (except header).
 * Use this to reset the sheet for a fresh test.
 */
function clearSyncSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('EmployeeSync');
  if (!sheet) { Logger.log('EmployeeSync sheet not found.'); return; }
  var last = sheet.getLastRow();
  if (last > 1) {
    sheet.deleteRows(2, last - 1);
    Logger.log('Cleared ' + (last - 1) + ' row(s).');
  } else {
    Logger.log('Sheet is already empty.');
  }
}

/**
 * Print a summary of what is currently in EmployeeSync.
 */
function inspectSyncSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('EmployeeSync');
  if (!sheet) { Logger.log('EmployeeSync sheet not found.'); return; }
  var last = sheet.getLastRow();
  if (last < 2) { Logger.log('Sheet is empty.'); return; }

  var rows = sheet.getRange(2, 1, last - 1, 6).getValues();
  rows.forEach(function(r) {
    var hasDesc = r[4] && String(r[4]).length > 5;
    Logger.log(
      r[0] + ' | ' + r[1] + ' | ' + r[2] + ' | ' + r[3] +
      ' | face: ' + (hasDesc ? 'YES' : 'no') +
      ' | updated: ' + r[5]
    );
  });
}
