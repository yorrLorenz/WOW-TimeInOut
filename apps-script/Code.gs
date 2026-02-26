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
 * The script writes to the active Google Sheet.
 * Columns: Branch | Employee | Date | Time In | Time Out
 */

var SHEET_NAME = 'Attendance';

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Branch', 'Employee', 'Date', 'Time In', 'Time Out', 'Logged At']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getOrCreateSheet();

    if (data.action === 'addLog') {
      sheet.appendRow([
        data.branch || '',
        data.employeeName || '',
        data.date || '',
        data.timeIn || '',
        data.timeOut || '',
        new Date().toISOString(),
      ]);
    } else if (data.action === 'bulkAddLogs' && Array.isArray(data.logs)) {
      var rows = data.logs.map(function (log) {
        return [
          log.branch || '',
          log.employeeName || '',
          log.date || '',
          log.timeIn || '',
          log.timeOut || '',
          new Date().toISOString(),
        ];
      });
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
      }
    } else {
      return jsonResponse({ success: false, error: 'Unknown action' }, 400);
    }

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

function doGet(e) {
  return jsonResponse({ status: 'TimeIn Apps Script is running.' });
}

function jsonResponse(data, code) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
