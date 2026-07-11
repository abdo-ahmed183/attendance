/**
 * Code.gs — Google Apps Script Web App backend for the attendance app.
 * Turns a Google Sheet into a small JSON REST API.
 *
 * SHEET LAYOUT EXPECTED
 * ----------------------------------------------------------------------
 * "Students" tab   — header row: الرقم التعريفى | اسم | الهاتف المحمول
 * "Centers" tab    — header row: السنتر   (one center name per row)
 * "Attendance Logs" tab — created automatically on first write if it
 *                    doesn't already exist, with the header row:
 *                    الرقم التعريفى | اسم الطالب | السنتر |
 *                    تاريخ ووقت الحضور | حالة الواجب
 *
 * ENDPOINTS
 * ----------------------------------------------------------------------
 * GET  {url}                    -> JSON array of students:
 *      [ { "الرقم التعريفى": "1001", "اسم": "...", "الهاتف المحمول": "..." }, ... ]
 *
 * GET  {url}?action=centers     -> JSON array of center names:
 *      [ "Center A", "Center B", ... ]
 *
 * POST {url}                    -> body is a single attendance object OR
 *      an array of them (this is what the app sends after an offline
 *      session, in one batched call):
 *      { "id": "1001", "name": "...", "center": "...",
 *        "timestamp": "2026-07-11 14:32:05", "homework": "Yes" }
 *      or  [ {...}, {...}, ... ]
 *      -> appends one row per record to "Attendance Logs" and returns
 *      { "status": "success", "inserted": <n> }
 *
 * OPTIONAL LIGHTWEIGHT AUTH
 * ----------------------------------------------------------------------
 * Set API_KEY below to a random string to require every request to
 * include a matching key (?key=... on GET, "key" field on POST body).
 * Leave it as '' to accept all requests (matches "Anyone" deployment
 * access with no extra step). This is a basic deterrent against casual
 * scraping/spam, not real authentication — anyone who can view your
 * client-side app.js can also read this key, so don't treat it as a
 * secret for sensitive data.
 */

const API_KEY = ''; // e.g. 'my-long-random-string' to enable the check

const SHEET_STUDENTS = 'Students';
const SHEET_CENTERS = 'Centers';
const SHEET_LOGS = 'Attendance Logs';

const LOG_HEADERS = [
  'الرقم التعريفى',
  'اسم الطالب',
  'السنتر',
  'تاريخ ووقت الحضور',
  'حالة الواجب',
];

// ---------------------------------------------------------------------
// doGet — data fetching
// ---------------------------------------------------------------------
function doGet(e) {
  try {
    if (!checkAuth(e.parameter && e.parameter.key)) {
      return jsonOutput({ status: 'error', message: 'Unauthorized' });
    }

    const action = e.parameter && e.parameter.action;

    if (action === 'centers') {
      return jsonOutput(readCenters());
    }

    // Default action: return the students master table as a clean JSON array.
    return jsonOutput(readStudents());
  } catch (err) {
    return jsonOutput({ status: 'error', message: String(err) });
  }
}

// ---------------------------------------------------------------------
// doPost — attendance logging (single record or bulk array)
// ---------------------------------------------------------------------
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (!checkAuth(payload.key)) {
      return jsonOutput({ status: 'error', message: 'Unauthorized' });
    }

    // Accept either one record or an array of records.
    const records = Array.isArray(payload) ? payload : [payload];

    const inserted = appendAttendanceRecords(records);
    return jsonOutput({ status: 'success', inserted: inserted });
  } catch (err) {
    return jsonOutput({ status: 'error', message: String(err) });
  }
}

// ---------------------------------------------------------------------
// Students / Centers readers
// ---------------------------------------------------------------------
function readStudents() {
  const sheet = getSheet(SHEET_STUDENTS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((h) => String(h).trim());
  const idxId = headers.indexOf('الرقم التعريفى');
  const idxName = headers.indexOf('اسم');
  const idxPhone = headers.indexOf('الهاتف المحمول');

  const rows = values.slice(1).filter((r) => r[idxId] !== '' && r[idxId] !== null);

  return rows.map((r) => ({
    'الرقم التعريفى': String(r[idxId]).trim(),
    'اسم': String(r[idxName] || '').trim(),
    'الهاتف المحمول': String(r[idxPhone] || '').trim(),
  }));
}

function readCenters() {
  const sheet = getSheet(SHEET_CENTERS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values
    .slice(1)
    .map((r) => String(r[0] || '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------
// Attendance Logs writer (auto-creates the sheet + header row)
// ---------------------------------------------------------------------
function appendAttendanceRecords(records) {
  if (!records.length) return 0;

  const sheet = getOrCreateLogSheet();

  const rows = records.map((r) => [
    r.id != null ? r.id : '',
    r.name != null ? r.name : '',
    r.center != null ? r.center : '',
    r.timestamp != null ? r.timestamp : '',
    r.homework != null ? r.homework : '',
  ]);

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  return rows.length;
}

function getOrCreateLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_LOGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LOGS);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function checkAuth(providedKey) {
  if (!API_KEY) return true; // auth disabled
  return providedKey === API_KEY;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
