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

  /**
  * Shared secret token — must match APPS_SCRIPT_TOKEN in src/lib/config.js.
  * Any request (POST or GET) that does not include this token is rejected.
  * Change this value and update config.js to match whenever you rotate the secret.
  */
  var APP_TOKEN = 'wt-timein-2026';

  var SHEET_NAME    = 'Attendance';
  var EMP_SHEET     = 'Employees';
  var MONTHLY_SHEET = 'Monthly Summary';
  var SYNC_SHEET    = 'EmployeeSync';   // stores descriptors — used for cross-branch face data sharing
  var BRANCH_SHEET  = 'Branches';       // custom branch accounts (code, name, pin)
  var MONITOR_SHEET = 'Individual Monitoring';

  /** SHA-256 hash of a PIN → 64-char hex string. Matches browser crypto.subtle output. */
  function hashPinGAS(pin) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      pin,
      Utilities.Charset.UTF_8
    );
    return bytes.map(function(b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');
  }

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
      sheet.appendRow(['UID', 'Staff', 'Date', 'Time In', 'Time Out', 'Branch In', 'Branch Out', 'Duration', 'Logged At', 'Lunch Start', 'Lunch End', 'Break Duration']);
      sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else {
      // Add lunch columns to existing sheets that pre-date this update
      if (!sheet.getRange(1, 10).getValue()) {
        sheet.getRange(1, 10).setValue('Lunch Start');
        sheet.getRange(1, 11).setValue('Lunch End');
        sheet.getRange(1, 12).setValue('Break Duration');
        sheet.getRange(1, 10, 1, 3).setFontWeight('bold');
      }
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
      sheet.appendRow(['Code', 'Name', 'PIN', 'isAdmin', 'Updated At']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.hideColumns(3); // Hide PIN column — restrict sheet access to owner only
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

  // ── Individual Monitoring sheet ───────────────────────────────────────────────

  function getOrCreateMonitoringSheet() {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(MONITOR_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(MONITOR_SHEET);
      setupMonitoringSheet(sheet);
    }
    return sheet;
  }

  function setupMonitoringSheet(sheet) {
    sheet.clearContents();
    sheet.clearFormats();

    // ── Title ──────────────────────────────────────────────────────────────────
    sheet.getRange('A1:I1').merge();
    sheet.getRange('A1')
      .setValue('Individual Employee Monitoring')
      .setFontSize(14).setFontWeight('bold')
      .setBackground('#d5006c').setFontColor('#ffffff')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sheet.setRowHeight(1, 44);

    // ── Controls row ──────────────────────────────────────────────────────────
    sheet.getRange('A3').setValue('Select Employee:').setFontWeight('bold');
    sheet.getRange('F3').setValue('Standard Hours / Day:').setFontWeight('bold');
    sheet.getRange('G3').setValue(8);  // editable — changes trigger a stats refresh
    sheet.getRange('I3').setValue('↑ Edit to change overtime threshold').setFontColor('#9e9e9e').setFontStyle('italic');

    // Dropdown data validation pointing to the Employees name column
    updateMonitoringDropdown(sheet);

    // ── Stats header row ───────────────────────────────────────────────────────
    var statsHdr = [['Employee ID', 'Home Branch', 'Total Days', 'Total Hours',
                    'Avg Hrs / Day', 'Overtime Days', 'Undertime Days', 'Last Seen']];
    sheet.getRange('A5:H5').setValues(statsHdr)
      .setFontWeight('bold').setBackground('#fce4ec')
      .setBorder(true, true, true, true, true, true, 'black', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange('A6:H6').setValue('—');
    sheet.getRange('A5:H6').setHorizontalAlignment('center');

    // ── Attendance history header ──────────────────────────────────────────────
    sheet.getRange('A8').setValue('Attendance History').setFontSize(12).setFontWeight('bold');
    var attHdr = [['Date', 'Time In', 'Time Out', 'Branch In', 'Branch Out', 'Duration', 'Hours']];
    sheet.getRange('A9:G9').setValues(attHdr)
      .setFontWeight('bold').setBackground('#fce4ec')
      .setBorder(true, true, true, true, true, true, 'black', SpreadsheetApp.BorderStyle.SOLID)
      .setHorizontalAlignment('center');

    sheet.setFrozenRows(9);

    // Column widths
    var widths = [120, 160, 100, 100, 120, 120, 80, 120, 220];
    for (var c = 0; c < widths.length; c++) sheet.setColumnWidth(c + 1, widths[c]);
  }

  /**
  * Refresh the dropdown in B3 to match the current Employees sheet.
  * Called after bulkSyncEmployees so the list stays current.
  */
  function updateMonitoringDropdown(sheet) {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var empSheet = ss.getSheetByName(EMP_SHEET);
    if (!sheet) sheet = ss.getSheetByName(MONITOR_SHEET);
    if (!sheet) return;

    var rule;
    if (empSheet && empSheet.getLastRow() > 1) {
      var nameRange = empSheet.getRange(2, 2, empSheet.getLastRow() - 1, 1);
      rule = SpreadsheetApp.newDataValidation()
        .requireValueInRange(nameRange, true)
        .setAllowInvalid(false)
        .setHelpText('Select an employee to view their attendance history.')
        .build();
    } else {
      rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['— No employees registered —'], true)
        .build();
    }
    sheet.getRange('B3').setDataValidation(rule);
  }

  /**
  * Compute and write stats + history rows for the selected employee.
  */
  function refreshMonitoringData(sheet, employeeName) {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var attSheet = ss.getSheetByName(SHEET_NAME);
    var empSheet = ss.getSheetByName(EMP_SHEET);
    var stdHours = Number(sheet.getRange('G3').getValue()) || 8;

    // Clear previous data
    var lastRow = sheet.getLastRow();
    if (lastRow >= 10) sheet.deleteRows(10, lastRow - 9);
    sheet.getRange('A6:H6').setValue('—');

    if (!employeeName || employeeName === '— No employees registered —') return;

    // ── Lookup employee UID + branch from Employees sheet ─────────────────────
    var uid = '', homeBranch = '', position = '';
    if (empSheet && empSheet.getLastRow() > 1) {
      var empData = empSheet.getRange(2, 1, empSheet.getLastRow() - 1, 4).getValues();
      for (var i = 0; i < empData.length; i++) {
        if (String(empData[i][1]) === String(employeeName)) {
          uid        = String(empData[i][0]);
          position   = String(empData[i][2]);
          homeBranch = String(empData[i][3]);
          break;
        }
      }
    }
    if (!uid) {
      sheet.getRange('A6').setValue('Employee not found — sync the Employees sheet first.');
      return;
    }

    // ── Pull matching attendance rows ──────────────────────────────────────────
    var entries = [];
    if (attSheet && attSheet.getLastRow() > 1) {
      var attData = attSheet.getRange(2, 1, attSheet.getLastRow() - 1, 9).getValues();
      for (var j = 0; j < attData.length; j++) {
        if (String(attData[j][0]) === uid) entries.push(attData[j]);
      }
    }

    // Sort by date descending (most recent first)
    entries.sort(function(a, b) {
      return new Date(toDateString(b[2])) - new Date(toDateString(a[2]));
    });

    // ── Compute stats ─────────────────────────────────────────────────────────
    var totalDays     = 0;
    var totalHours    = 0;
    var overtimeDays  = 0;
    var undertimeDays = 0;
    var completeDays  = 0;  // only count entries that have a Time Out

    for (var k = 0; k < entries.length; k++) {
      var hrs = parseDurationHours(entries[k][7]);
      totalDays++;
      if (hrs > 0) {
        completeDays++;
        totalHours += hrs;
        if (hrs > stdHours)       overtimeDays++;
        else if (hrs < stdHours)  undertimeDays++;
      }
    }

    var avgHours = completeDays > 0 ? Math.round((totalHours / completeDays) * 100) / 100 : 0;
    totalHours   = Math.round(totalHours * 100) / 100;
    var lastSeen = entries.length > 0 ? toDateString(entries[0][2]) : '—';

    sheet.getRange('A6:H6').setValues([[
      uid,
      homeBranch + (position ? ' · ' + position : ''),
      totalDays,
      totalHours + ' hrs',
      avgHours + ' hrs',
      overtimeDays,
      undertimeDays,
      lastSeen,
    ]]).setHorizontalAlignment('center');

    // ── Write history rows ─────────────────────────────────────────────────────
    if (entries.length === 0) {
      sheet.getRange('A10').setValue('No attendance records found for this employee.');
      return;
    }

    var rows = entries.map(function(e) {
      var h = parseDurationHours(e[7]);
      return [
        toDateString(e[2]),
        e[3] || '',
        e[4] || '',
        e[5] || '',
        e[6] || '',
        e[7] || '',
        h > 0 ? Math.round(h * 100) / 100 : '',
      ];
    });

    sheet.getRange(10, 1, rows.length, 7).setValues(rows);

    // Alternating row colors + highlight incomplete days (no Time Out)
    for (var r = 0; r < rows.length; r++) {
      var hasTimeout = rows[r][2] !== '';
      var bg = hasTimeout
        ? (r % 2 === 0 ? '#ffffff' : '#fce4ec')
        : '#fff9c4';  // yellow tint for open/incomplete entries
      sheet.getRange(10 + r, 1, 1, 7).setBackground(bg);
    }
  }

  /** Parse "Xh Ym" duration string → decimal hours. */
  function parseDurationHours(durationStr) {
    if (!durationStr) return 0;
    var match = String(durationStr).match(/(\d+)h\s*(\d+)m/);
    if (!match) return 0;
    return parseInt(match[1]) + parseInt(match[2]) / 60;
  }

  /**
  * onEdit simple trigger — fires whenever any cell is edited in the spreadsheet.
  * Handles the employee dropdown (B3) and standard hours field (G3).
  */
  function onEdit(e) {
    var range = e.range;
    var sheet = range.getSheet();
    if (sheet.getName() !== MONITOR_SHEET) return;

    var cell = range.getA1Notation();

    if (cell === 'B3') {
      refreshMonitoringData(sheet, range.getValue());
      return;
    }
    // Re-run if standard hours threshold is changed while an employee is selected
    if (cell === 'G3') {
      var selected = sheet.getRange('B3').getValue();
      if (selected) refreshMonitoringData(sheet, selected);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  function doPost(e) {
    try {
      var data  = JSON.parse(e.postData.contents);
      if (!data.token || data.token !== APP_TOKEN) {
        return jsonResponse({ success: false, error: 'Unauthorized' });
      }
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
          data.lunchStart    || '',
          data.lunchEnd      || '',
          data.lunchDuration || '',
        ]);

      // ── Attendance: update existing row (Time Out or Lunch Break) ─────────────
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
              // Lunch break columns — update only when the field is explicitly provided
              if (data.lunchStart    !== undefined) sheet.getRange(rowNum, 10).setValue(data.lunchStart    || '');
              if (data.lunchEnd      !== undefined) sheet.getRange(rowNum, 11).setValue(data.lunchEnd      || '');
              if (data.lunchDuration !== undefined) sheet.getRange(rowNum, 12).setValue(data.lunchDuration || '');
              updated = true;
              break;
            }
          }
        }
        if (!updated) {
          // Row not found (was offline) — append a complete row instead.
          sheet.appendRow([
            data.uid || '', data.employeeName || '', data.date || '',
            data.timeIn || '', data.timeOut || '', data.branchIn || '',
            data.branchOut || '', data.duration || '', new Date().toISOString(),
            data.lunchStart || '', data.lunchEnd || '', data.lunchDuration || '',
          ]);
        }

      // ── Attendance: bulk push offline logs ────────────────────────────────────
      } else if (data.action === 'bulkAddLogs' && Array.isArray(data.logs)) {
        var rows = data.logs.map(function (log) {
          return [
            log.uid || '', log.employeeName || '', log.date || '',
            log.timeIn || '', log.timeOut || '', log.branchIn || '',
            log.branchOut || '', log.duration || '', new Date().toISOString(),
            log.lunchStart || '', log.lunchEnd || '', log.lunchDuration || '',
          ];
        });
        if (rows.length > 0) {
          sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 12).setValues(rows);
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

        // Keep Individual Monitoring dropdown in sync with the updated employee list
        var monSheet = getOrCreateMonitoringSheet();
        updateMonitoringDropdown(monSheet);

      // ── Monthly Summary: replace period rows then append new ones ─────────────
      } else if (data.action === 'generateMonthlySummary') {
        // Lock prevents two branches auto-generating the same period simultaneously
        var lock = LockService.getScriptLock();
        lock.waitLock(10000);
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
        lock.releaseLock();

      // ── Branches: upsert (create or update) ──────────────────────────────────
      } else if (data.action === 'upsertBranch') {
        var bSheet = getOrCreateBranchSheet();
        var bLast  = bSheet.getLastRow();
        var bFound = false;
        if (bLast > 1) {
          var bCodes = bSheet.getRange(2, 1, bLast - 1, 1).getValues();
          for (var bi = 0; bi < bCodes.length; bi++) {
            if (String(bCodes[bi][0]) === String(data.code)) {
              // If no new PIN provided (empty string), keep the existing one
              var existingPin = String(bSheet.getRange(bi + 2, 3).getValue());
              var pinToStore  = (data.pin !== '' && data.pin != null) ? data.pin : existingPin;
              bSheet.getRange(bi + 2, 1, 1, 5).setValues([[
                data.code || '',
                data.name || '',
                pinToStore,
                data.isAdmin ? 'true' : 'false',
                new Date().toISOString(),
              ]]);
              bFound = true;
              break;
            }
          }
        }
        if (!bFound) {
          bSheet.appendRow([data.code || '', data.name || '', data.pin || '', data.isAdmin ? 'true' : 'false', new Date().toISOString()]);
        }

      // ── Branches: one-time PIN hash migration ─────────────────────────────────
      } else if (data.action === 'migratePinHashes') {
        var mBSheet = getOrCreateBranchSheet();
        var mBLast  = mBSheet.getLastRow();
        var count   = 0;
        if (mBLast > 1) {
          var pinData = mBSheet.getRange(2, 1, mBLast - 1, 3).getValues();
          for (var mi = 0; mi < pinData.length; mi++) {
            var existingP = String(pinData[mi][2]);
            // Skip if already a 64-char hex hash or empty
            if (!existingP || /^[0-9a-f]{64}$/.test(existingP)) continue;
            mBSheet.getRange(mi + 2, 3).setValue(hashPinGAS(existingP));
            count++;
          }
        }
        return jsonResponse({ success: true, migrated: count });

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
    if (!params.token || params.token !== APP_TOKEN) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    if (params.action === 'getBranches') {
      try {
        var bSheet = getOrCreateBranchSheet();
        var last   = bSheet.getLastRow();
        if (last < 2) return jsonResponse({ branches: [] });
        var rows = bSheet.getRange(2, 1, last - 1, 5).getValues();
        var branches = rows
          .filter(function(r) { return r[0]; })
          .map(function(r) {
            return {
              code:    String(r[0]),
              name:    String(r[1]),
              pin:     String(r[2]),
              isAdmin: String(r[3]) === 'true',
            };
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
