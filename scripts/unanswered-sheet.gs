// LINE bot -> "Unanswered" tab. Setup steps: README -> แจ้งเตือนแอดมิน
// Paste this whole file over everything in Code.gs, Save, then Deploy -> New version.
// Script property SECRET must equal UNANSWERED_SHEET_SECRET in Vercel.

function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_("bad_json");
  }
  if (!secret || data.secret !== secret) {
    return reply_("unauthorized");
  }

  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName("Unanswered");
  if (!sheet) {
    sheet = book.insertSheet("Unanswered");
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["เวลา", "ชื่อลูกค้า", "userId (6 ตัวท้าย)", "คำถาม", "สาเหตุ", "สถานะ"]);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([
    new Date(),
    asText_(data.name),
    asText_(data.user),
    asText_(data.question),
    asText_(data.reason),
    "รอตอบ"
  ]);
  return reply_("ok");
}

// Leading ' keeps Sheets from turning text like "=1+1" into a formula.
function asText_(v) {
  return "'" + String(v == null ? "" : v);
}

function reply_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
