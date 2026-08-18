/** VISUAL OS — Unificación de biblioteca con dedup por MD5
 *  Requiere: Servicios > Drive API v3
 *  LIB_uni_dry()    previsualiza
 *  LIB_uni_apply()  ejecuta (reanudable)
 *  LIB_uni_reset()  reinicia el cursor
 */

const LIB_ROOT = '1WCjfFllc76t7X9BEM63AFQleFeuNRD3b';
const LIB_LOG  = '00. Unificacion LOG';

// origen -> destino
const LIB_PARES = [
  ['06. Candidates', '02. Library'],
  ['05. Ready',      '01. Aprobadas']
];

function LIB_uni_dry()   { return LIB_uni(true);  }
function LIB_uni_apply() { return LIB_uni(false); }
function LIB_uni_reset() {
  PropertiesService.getScriptProperties().deleteProperty('LIB_CURSOR');
  return 'Cursor reiniciado.';
}

function LIB_uni(dry) {
  const t0 = Date.now();
  const LIMITE_MS = 4.5 * 60 * 1000;          // corta antes de los 6 min
  const props = PropertiesService.getScriptProperties();
  let cursor = Number(props.getProperty('LIB_CURSOR') || 0);

  const root = DriveApp.getFolderById(LIB_ROOT);
  const filas = [];
  let movidos = 0, dupes = 0, bytesLib = 0;

  // ---- construir lista de trabajos (origen, destino) hoja por hoja
  const trabajos = [];
  LIB_PARES.forEach(function (par) {
    const org = subFolder(root, par[0]);
    const dst = subFolder(root, par[1]);
    if (!org || !dst) { filas.push(['(aviso)', par.join(' -> '), 'NO ENCONTRADO', '', '']); return; }
    recolectar(org, dst, [], trabajos);
  });

  if (cursor >= trabajos.length && cursor > 0) {
    return 'Nada pendiente. ' + trabajos.length + ' hojas ya procesadas. Usa LIB_uni_reset() para repetir.';
  }

  // ---- procesar desde el cursor
  let i = cursor;
  for (; i < trabajos.length; i++) {
    if (Date.now() - t0 > LIMITE_MS) break;

    const t = trabajos[i];
    const dstFiles = indexar(t.dstId);          // md5 -> true
    const orgFiles = listar(t.orgId);

    orgFiles.forEach(function (f) {
      const ruta = t.ruta.join('/') + '/' + f.name;
      if (f.md5 && dstFiles[f.md5]) {
        filas.push([ruta, f.name, 'DUPLICADO EXACTO', 'papelera', kb(f.size)]);
        dupes++; bytesLib += Number(f.size || 0);
        if (!dry) DriveApp.getFileById(f.id).setTrashed(true);
      } else {
        filas.push([ruta, f.name, 'UNICO', 'movido a destino', kb(f.size)]);
        movidos++;
        if (!dry) {
          const file = DriveApp.getFileById(f.id);
          DriveApp.getFolderById(t.dstId).addFile(file);
          DriveApp.getFolderById(t.orgId).removeFile(file);
          if (f.md5) dstFiles[f.md5] = true;    // evita re-duplicar en la misma hoja
        }
      }
    });
  }

  if (!dry) props.setProperty('LIB_CURSOR', String(i));

  escribirLog(filas, dry);

  const pend = trabajos.length - i;
  return (dry ? 'DRY RUN — nada modificado' : 'APLICADO')
    + '\nHojas: ' + i + '/' + trabajos.length + (pend > 0 ? '  (faltan ' + pend + ' — vuelve a correr)' : '  COMPLETO')
    + '\nUnicos movidos: ' + movidos
    + '\nDuplicados exactos: ' + dupes + '  (' + kb(bytesLib) + ' KB liberables)'
    + '\nBorrado permanente: 0';
}

/* ---------- helpers ---------- */

function subFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

// recorre origen y espeja la ruta en destino, creando lo que falte
function recolectar(org, dst, ruta, acc) {
  const subs = org.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    let d = subFolder(dst, s.getName());
    if (!d) d = dst.createFolder(s.getName());
    recolectar(s, d, ruta.concat(s.getName()), acc);
  }
  acc.push({ orgId: org.getId(), dstId: dst.getId(), ruta: ruta });
}

// un solo llamado a la API por carpeta
function listar(folderId) {
  const out = [];
  let token = null;
  do {
    const r = Drive.Files.list({
      q: "'" + folderId + "' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'",
      fields: 'nextPageToken, files(id,name,size,md5Checksum)',
      pageSize: 1000,
      supportsAllDrives: true
    });
    (r.files || []).forEach(function (f) {
      out.push({ id: f.id, name: f.name, size: f.size, md5: f.md5Checksum });
    });
    token = r.nextPageToken;
  } while (token);
  return out;
}

function indexar(folderId) {
  const m = {};
  listar(folderId).forEach(function (f) { if (f.md5) m[f.md5] = true; });
  return m;
}

function kb(b) { return Math.round(Number(b || 0) / 1024); }

function escribirLog(filas, dry) {
  const ss = SpreadsheetApp.openById('1R9sCK5__hUld0hEaDFfB7tbuDst0PbSZSSS0Sh16NnM');
  let sh = ss.getSheetByName(LIB_LOG);
  if (!sh) {
    sh = ss.insertSheet(LIB_LOG);
    sh.appendRow(['Ruta', 'Archivo', 'Tipo', 'Accion', 'KB']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold').setFrozenRows;
  }
  if (dry) { sh.clear(); sh.appendRow(['Ruta', 'Archivo', 'Tipo', 'Accion', 'KB']); }
  if (filas.length) sh.getRange(sh.getLastRow() + 1, 1, filas.length, 5).setValues(filas);
}


function LIB_checkDrive() {
  try {
    const r = Drive.Files.list({ pageSize: 1, fields: 'files(id,md5Checksum)' });
    Logger.log('OK — servicio Drive activo. md5Checksum disponible.');
  } catch (e) {
    Logger.log('FALLA: ' + e.message);
  }
}

function LIB_resumen() {
  const ss = SpreadsheetApp.openById('1R9sCK5__hUld0hEaDFfB7tbuDst0PbSZSSS0Sh16NnM');
  const sh = ss.getSheetByName('00. Unificacion LOG');
  if (!sh) return Logger.log('No existe la pestaña. ¿Corrió LIB_uni_dry?');
  const d = sh.getDataRange().getValues();
  let dup = 0, uni = 0, kbDup = 0;
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][2]).indexOf('DUPLICADO') > -1) { dup++; kbDup += Number(d[i][4] || 0); }
    else if (String(d[i][2]) === 'UNICO') uni++;
  }
  Logger.log('Filas: ' + (d.length - 1) +
    '\nDuplicados exactos: ' + dup + '  (' + Math.round(kbDup / 1024) + ' MB liberables)' +
    '\nUnicos a mover: ' + uni);
}
