/** Visual Identity OS — FASE 2 · versión final autocontenida.
 *  F2_dry()   -> previsualiza, no escribe
 *  F2_apply() -> escribe
 */

function F2_dry()   { return F2_run(true);  }
function F2_apply() { return F2_run(false); }

function F2_run(dry) {
  const t0 = Date.now();
  const ss = SpreadsheetApp.openById('1R9sCK5__hUld0hEaDFfB7tbuDst0PbSZSSS0Sh16NnM');

  const PACK_ID   = '12SXCG7UYJS5p1pgpPz_zNNgKmuhxlili';
  const OUT_TAB   = '00_Audit_v44_PREVIEW';
  const SKIP      = ['00_Audit_v44_484_MAP', '00_Audit_v44_PREVIEW'];

  const ROUTING = [
    ['Visual Identity OS Prompt Generator V4.2.2',
     'Visual Identity OS Prompt Generator V4.4 — Identity authority: David Master Pack v5.0'],
    ['DAVID_IDENTITY_CARD_V4_2_2C_CLEAN_LOCK_ACTIVE',
     'DAVID_MASTER_PACK_V5_0 + APPROVED_IDENTITY_ANCHORS_2026-08-07'],
    ['DAVID_IDENTITY_CARD_V4.2.2B_CLEAN_LOCK',
     'DAVID_MASTER_PACK_V5_0 (Priority 0: Approved identity anchors | 2026-08-07)'],
    ['JUAN_IDENTITY_CARD_V4_2_2_CLEAN_LOCK_ACTIVE',
     'JUAN_PACK_V4_4_0 + APPROVED_MULTIANGLE_PRIORITY_0_2026-08-07']
  ];

  const CARDS = {
    'DAVID_IDENTITY_CARD_V4_2_2B_CLEAN_LOCK.png': 'SUPERSEDED_SUPPORT',
    'DAVID_IDENTITY_CARD_V4_2_2C_CLEAN_LOCK.png': 'SUPERSEDED_SUPPORT',
    'JUAN_IDENTITY_CARD_V4_2_2_CLEAN_LOCK.png':   'SUPPORT_ONLY'
  };

  const rep = [['Sheet', 'Celda', 'Tipo', 'Antes', 'Despues']];
  let written = 0;

  ss.getSheets().forEach(function (sh) {
    const name = sh.getName();
    if (SKIP.indexOf(name) > -1) return;

    const rng  = sh.getDataRange();
    const vals = rng.getValues();
    const fmls = rng.getFormulas();
    if (!vals.length) return;

    const hdr = vals[0];
    const low = hdr.map(function (x) { return String(x).toLowerCase().trim(); });
    const cAsset  = low.indexOf('asset');
    const cStatus = low.indexOf('status');

    // acumulamos cambios de esta pestaña y escribimos al final
    const edits = [];

    for (let r = 0; r < vals.length; r++) {
      for (let c = 0; c < vals[r].length; c++) {
        if (fmls[r][c]) continue;                    // jamas tocar formulas
        const raw = vals[r][c];
        if (raw === '' || raw === null) continue;
        const s = String(raw);

        // A · routing
        let nv = s, hit = false;
        for (let k = 0; k < ROUTING.length; k++) {
          if (nv.indexOf(ROUTING[k][0]) > -1) {
            nv = nv.split(ROUTING[k][0]).join(ROUTING[k][1]); hit = true;
          }
        }
        if (hit) { edits.push([r, c, nv, 'ROUTING_V5', s]); continue; }

        // B · 484
        if (s.trim() === '484') {
          const h = String(hdr[c] || '').toLowerCase();
          let v = null;
          if (h.indexOf('link') > -1 || h.indexOf('url') > -1) v = 'Not uploaded';
          else if (h.indexOf('score') > -1 || h.indexOf('accuracy') > -1) v = 'N/A';
          else if (name.indexOf('Result_Memory') > -1) v = 'N/A';
          if (v) edits.push([r, c, v, 'ARTEFACTO_484', '484']);
          continue;
        }

        // C · cards legacy
        if (cAsset > -1 && cStatus > -1 && c === cStatus && r > 0) {
          const key = String(vals[r][cAsset]).trim();
          if (CARDS[key] && s !== CARDS[key]) {
            edits.push([r, c, CARDS[key], 'CARD_LEGACY', s]);
          }
        }
      }
    }

    edits.forEach(function (e) {
      const cell = sh.getRange(e[0] + 1, e[1] + 1);
      rep.push([name, cell.getA1Notation(), e[3],
                String(e[4]).slice(0, 80), String(e[2]).slice(0, 80)]);
      if (!dry) { cell.setValue(e[2]); written++; }   // solo la celda afectada
    });
  });

  // Drive
  const f = DriveApp.getFileById(PACK_ID);
  const NN = 'David | Pack notes v4.4.0 — SUPERSEDED BY v5.0.txt';
  if (f.getName() !== NN) {
    rep.push(['(Drive)', PACK_ID, 'RENOMBRAR', f.getName(), NN]);
    if (!dry) { f.setName(NN); written++; }
  } else {
    rep.push(['(Drive)', PACK_ID, 'OK', NN, 'ya renombrado']);
  }

  let t = ss.getSheetByName(OUT_TAB);
  if (t) { t.clear(); } else { t = ss.insertSheet(OUT_TAB); }
  t.getRange(1, 1, rep.length, 5).setValues(rep);
  t.getRange(1, 1, 1, 5).setFontWeight('bold');
  t.setFrozenRows(1);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const msg = (dry ? 'DRY RUN — nada modificado' : 'APLICADO — ' + written + ' cambios')
    + '\n' + (rep.length - 1) + ' filas en ' + OUT_TAB + '\n' + secs + ' s';
  Logger.log(msg);
  return msg;
}
