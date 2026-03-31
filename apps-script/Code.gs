/**
 * TimeIn — Google Apps Script Web App
 *
 * Deploy this as a Web App:
 *   1. Open this file in the Apps Script editor.
 *   2. Click Deploy → New deployment.
 *   3. Type: Web App.
 *   4. Execute as: Me.
 *   5. Who has access: Anyone.
 *   6. Copy the Web App URL and paste it into the app's Admin → Settings page.
 *
 * Sheets managed:
 *   "Attendance"      — one row per Time In / Time Out event
 *   "Employees"       — employee directory (synced from app)
 *   "Monthly Summary" — 15-day period attendance totals (generated from app)
 */

var SHEET_NAME    = 'Attendance';
var EMP_SHEET     = 'Employees';
var MONTHLY_SHEET = 'Monthly Summary';
var SYNC_SHEET    = 'EmployeeSync';   // stores descriptors — used for cross-branch face data sharing
var BRANCH_SHEET  = 'Branches';       // custom branch accounts (code, name, pin)

/** Normalise any date value from a sheet cell to 'yyyy-MM-dd'. */
function toDateString(val) {
  if (!val) return '';
  var d = (val instanceof Date) ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getOrCreateSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['UID', 'Staff', 'Date', 'Time In', 'Time Out', 'Branch In', 'Branch Out', 'Duration', 'Logged At']);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateEmployeeSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EMP_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(EMP_SHEET);
    sheet.appendRow(['UID', 'Name', 'Position', 'Home Branch', 'Face Registered', 'Created At']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateMonthlySheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MONTHLY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MONTHLY_SHEET);
    sheet.appendRow(['Period', 'UID', 'Name', 'Home Branch', 'Working Days', 'Total Hours', 'Overtime Days', 'Undertime Days', 'Generated At']);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getOrCreateBranchSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BRANCH_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BRANCH_SHEET);
    sheet.appendRow(['Code', 'Name', 'PIN', 'Updated At']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Protect PIN column from casual viewing — admin should restrict sheet access
    sheet.hideColumns(3);
  }
  return sheet;
}

function getOrCreateSyncSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SYNC_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SYNC_SHEET);
    sheet.appendRow(['UID', 'Name', 'Position', 'Home Branch', 'Descriptors', 'Updated At']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Hide the Descriptors column — it's machine data, not human-readable
    sheet.hideColumns(5);
  }
  return sheet;
}

function doPost(e) {
  try {
    var data  = JSON.parse(e.postData.contents);
    var sheet = getOrCreateSheet();

    // ── Attendance: add a new Time In row ─────────────────────────────────────
    if (data.action === 'addLog') {
      sheet.appendRow([
        data.uid || '',
        data.employeeName || '',
        data.date || '',
        data.timeIn || '',
        data.timeOut || '',
        data.branchIn || '',
        data.branchOut || '',
        data.duration || '',
        new Date().toISOString(),
      ]);

    // ── Attendance: update existing row with Time Out ─────────────────────────
    } else if (data.action === 'updateLog') {
      var lastRow = sheet.getLastRow();
      var updated = false;
      if (lastRow > 1) {
        var colData = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
        for (var i = 0; i < colData.length; i++) {
          if (String(colData[i][0]) === String(data.uid) &&
              toDateString(colData[i][2]) === String(data.date)) {
            var rowNum = i + 2;
            sheet.getRange(rowNum, 5).setValue(data.timeOut   || '');
            sheet.getRange(rowNum, 7).setValue(data.branchOut || '');
            sheet.getRange(rowNum, 8).setValue(data.duration  || '');
            sheet.getRange(rowNum, 9).setValue(new Date().toISOString());
            updated = true;
            break;
          }
        }
      }
      if (!updated) {
        // Time In row not found (was offline) — append a complete row instead.
        sheet.appendRow([
          data.uid || '', data.employeeName || '', data.date || '',
          data.timeIn || '', data.timeOut || '', data.branchIn || '',
          data.branchOut || '', data.duration || '', new Date().toISOString(),
        ]);
      }

    // ── Attendance: bulk push offline logs ────────────────────────────────────
    } else if (data.action === 'bulkAddLogs' && Array.isArray(data.logs)) {
      var rows = data.logs.map(function (log) {
        return [
          log.uid || '', log.employeeName || '', log.date || '',
          log.timeIn || '', log.timeOut || '', log.branchIn || '',
          log.branchOut || '', log.duration || '', new Date().toISOString(),
        ];
      });
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
      }

    // ── EmployeeSync: upsert a single employee with face descriptors ──────────
    } else if (data.action === 'upsertEmployee') {
      var syncSheet = getOrCreateSyncSheet();
      var sLast     = syncSheet.getLastRow();
      var sFound    = false;
      if (sLast > 1) {
        var sUIDs = syncSheet.getRange(2, 1, sLast - 1, 1).getValues();
        for (var si = 0; si < sUIDs.length; si++) {
          if (String(sUIDs[si][0]) === String(data.uid)) {
            var sRow = si + 2;
            syncSheet.getRange(sRow, 1, 1, 6).setValues([[
              data.uid          || '',
              data.name         || '',
              data.position     || '',
              data.homeBranch   || '',
              data.descriptors  ? JSON.stringify(data.descriptors) : '',
              new Date().toISOString(),
            ]]);
            sFound = true;
            break;
          }
        }
      }
      if (!sFound) {
        syncSheet.appendRow([
          data.uid         || '',
          data.name        || '',
          data.position    || '',
          data.homeBranch  || '',
          data.descriptors ? JSON.stringify(data.descriptors) : '',
          new Date().toISOString(),
        ]);
      }

    // ── Employees: full replace (push all employees from app) ─────────────────
    } else if (data.action === 'bulkSyncEmployees' && Array.isArray(data.employees)) {
      var empSheet = getOrCreateEmployeeSheet();
      var empLast  = empSheet.getLastRow();
      if (empLast > 1) empSheet.deleteRows(2, empLast - 1);

      if (data.employees.length > 0) {
        var empRows = data.employees.map(function (emp) {
          return [
            emp.uid       || '',
            emp.name      || '',
            emp.position  || '',
            emp.homeBranch || '',
            emp.faceRegistered ? 'Yes (' + emp.faceCount + ' samples)' : 'No',
            emp.createdAt || '',
          ];
        });
        empSheet.getRange(2, 1, empRows.length, 6).setValues(empRows);
      }

    // ── Monthly Summary: replace period rows then append new ones ─────────────
    } else if (data.action === 'generateMonthlySummary') {
      var mSheet  = getOrCreateMonthlySheet();
      var period  = String(data.period || '');
      var mRows   = Array.isArray(data.rows) ? data.rows : [];

      // Delete any existing rows for this period (iterate backwards to keep indices stable)
      var mLast = mSheet.getLastRow();
      if (mLast > 1) {
        var pData = mSheet.getRange(2, 1, mLast - 1, 1).getValues();
        for (var pi = pData.length - 1; pi >= 0; pi--) {
          if (String(pData[pi][0]) === period) {
            mSheet.deleteRow(pi + 2);
          }
        }
      }

      if (mRows.length > 0) {
        var generatedAt = new Date().toISOString();
        var newRows = mRows.map(function (r) {
          return [
            period,
            r.uid          || '',
            r.name         || '',
            r.branch       || '',
            r.workingDays  || 0,
            r.totalHours   || 0,
            r.overtimeDays || 0,
            r.undertimeDays || 0,
            generatedAt,
          ];
        });
        mSheet.getRange(mSheet.getLastRow() + 1, 1, newRows.length, 9).setValues(newRows);
      }

    // ── Branches: upsert (create or update) ──────────────────────────────────
    } else if (data.action === 'upsertBranch') {
      var bSheet = getOrCreateBranchSheet();
      var bLast  = bSheet.getLastRow();
      var bFound = false;
      if (bLast > 1) {
        var bCodes = bSheet.getRange(2, 1, bLast - 1, 1).getValues();
        for (var bi = 0; bi < bCodes.length; bi++) {
          if (String(bCodes[bi][0]) === String(data.code)) {
            bSheet.getRange(bi + 2, 1, 1, 4).setValues([[
              data.code || '',
              data.name || '',
              data.pin  || '',
              new Date().toISOString(),
            ]]);
            bFound = true;
            break;
          }
        }
      }
      if (!bFound) {
        bSheet.appendRow([data.code || '', data.name || '', data.pin || '', new Date().toISOString()]);
      }

    // ── Branches: delete ──────────────────────────────────────────────────────
    } else if (data.action === 'deleteBranch') {
      var bSheet2 = getOrCreateBranchSheet();
      var bLast2  = bSheet2.getLastRow();
      if (bLast2 > 1) {
        var bCodes2 = bSheet2.getRange(2, 1, bLast2 - 1, 1).getValues();
        for (var bj = bCodes2.length - 1; bj >= 0; bj--) {
          if (String(bCodes2[bj][0]) === String(data.code)) {
            bSheet2.deleteRow(bj + 2);
            break;
          }
        }
      }

    } else {
      return jsonResponse({ success: false, error: 'Unknown action' });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  if (params.action === 'getBranches') {
    try {
      var bSheet = getOrCreateBranchSheet();
      var last   = bSheet.getLastRow();
      if (last < 2) return jsonResponse({ branches: [] });
      var rows = bSheet.getRange(2, 1, last - 1, 4).getValues();
      var branches = rows
        .filter(function(r) { return r[0]; })
        .map(function(r) {
          return { code: String(r[0]), name: String(r[1]), pin: String(r[2]) };
        });
      return jsonResponse({ branches: branches });
    } catch(err) {
      return jsonResponse({ branches: [], error: err.message });
    }
  }

  if (params.action === 'getEmployees') {
    try {
      var syncSheet = getOrCreateSyncSheet();
      var last = syncSheet.getLastRow();
      if (last < 2) return jsonResponse({ employees: [] });
      var rows = syncSheet.getRange(2, 1, last - 1, 6).getValues();
      var employees = rows
        .filter(function(r) { return r[0]; })   // skip blank UID rows
        .map(function(r) {
          var descriptors = [];
          try { if (r[4]) descriptors = JSON.parse(r[4]); } catch(ex) {}
          return {
            uid:         String(r[0]),
            name:        String(r[1]),
            position:    String(r[2]),
            homeBranch:  String(r[3]),
            descriptors: descriptors,
            updatedAt:   String(r[5]),
          };
        });
      return jsonResponse({ employees: employees });
    } catch(err) {
      return jsonResponse({ employees: [], error: err.message });
    }
  }
  return jsonResponse({ status: 'TimeIn Apps Script is running.' });
}

function jsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
