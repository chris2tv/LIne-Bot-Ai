/**
 * Google Apps Script web app: the LINE bot POSTs each question it could not answer,
 * and this appends a row to the "Unanswered" tab.
 *
 * Setup (see README → "แจ้งเตือนแอดมิน"):
 *  1. Use a SEPARATE spreadsheet from the published FAQ sheet (customer questions must not be public).
 *  2. Extensions → Apps Script → paste this file → Save.
 *  3. Project Settings → Script properties → add SECRET = a long random string
 *     (same value as UNANSWERED_SHEET_SECRET in Vercel).
 *  4. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → Deploy.
 *  5. Copy the Web app URL (ends in /exec) into Vercel → UNANSWERED_SHEET_URL, then Redeploy.
 */
const SHEET_NAME = "Unanswered";
const HEADER = ["เวลา", "ชื่อลูกค้า", "userId (6 ตัวท้าย)", "คำถาม", "สาเหตุ", "สถานะ"];

function doPost(e) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return text("bad_json");
  }
  if (!secret || data.secret !== secret) return text("unauthorized");

  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
  }
  // Leading ' keeps Sheets from turning text like "=1+1" or "08:00" into formulas/dates.
  const safe = (v) => "'" + String(v == null ? "" : v);
  sheet.appendRow([
    new Date(),
    safe(data.name),
    safe(data.user),
    safe(data.question),
    safe(data.reason),
    "รอตอบ",
  ]);
  return text("ok");
}

function text(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
