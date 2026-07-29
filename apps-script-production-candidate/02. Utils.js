function getSheet_(name) {
  const ss = SpreadsheetApp.openById(STATIC_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}`);
  return sheet;
}

function headerMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  return headers.reduce((acc, h, i) => {
    if (h) acc[String(h).trim()] = i + 1;
    return acc;
  }, {});
}

function rowObject_(sheet, row) {
  const headers = headerMap_(sheet);
  const values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const out = {};
  Object.keys(headers).forEach(k => out[k] = values[headers[k] - 1]);
  return out;
}

function appendObject_(sheet, obj) {
  const headers = headerMap_(sheet);
  const row = new Array(sheet.getLastColumn()).fill('');
  Object.keys(obj).forEach(k => {
    if (headers[k]) row[headers[k] - 1] = obj[k];
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function setCellByHeader_(sheet, row, header, value) {
  const headers = headerMap_(sheet);
  if (!headers[header]) throw new Error(`Missing column ${header} in ${sheet.getName()}`);
  sheet.getRange(row, headers[header]).setValue(value);
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'America/Bogota', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function newId_(prefix) {
  const stamp = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyyMMdd-HHmmss');
  return `${prefix}-${stamp}-${Utilities.getUuid().slice(0, 6).toUpperCase()}`;
}

function sanitizeToken_(value, fallback) {
  const clean = String(value || fallback || '')
    .replace(/[\\/:*?"<>|#%{}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || fallback;
}

function moveFile_(file, destinationFolderId) {
  const destination = DriveApp.getFolderById(destinationFolderId);
  destination.addFile(file);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() !== destinationFolderId) parent.removeFile(file);
  }
}

function escapeJsonText_(s) {
  return String(s || '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}