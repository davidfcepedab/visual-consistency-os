function MAMBO_dry()   { return MAMBO_fix(true);  }
function MAMBO_apply() { return MAMBO_fix(false); }

function MAMBO_fix(dry) {
  const DESTINO = '12sLCjI2ag02icxszfDjbxiTV-pzjUJBs';  // Generated Golden support | Not Identity
  const ORIGEN  = '12kcsez7Ku_jYIwhrLRg5GC8wbxX69K80';  // Real identity references | Priority 0
  const IDS = [
    '1p3ExlCc_mCStKZiaIAVjNdMpJqCBWqBN',  // Happy closeup - v01
    '1SOk3EukZK82jNoq87U90rs0BnD7y6Urv',  // Living rug happy - v02
    '1MYNEMxvGxaLspLWN6RkgFTZM6B977IoX',  // Sofa window happy - v03
    '1HjQQYrSYls-PViufnVxLpavAO0IMyn4x'   // Store candid happy - v04
  ];

  const dest = DriveApp.getFolderById(DESTINO);
  const orig = DriveApp.getFolderById(ORIGEN);
  const out = [];

  IDS.forEach(function (id) {
    const f = DriveApp.getFileById(id);
    out.push(f.getName() + '   Priority 0  ->  Generated Golden support | Not Identity');
    if (!dry) { dest.addFile(f); orig.removeFile(f); }
  });

  const msg = (dry ? 'DRY RUN — nada movido' : 'APLICADO — 4 archivos reclasificados')
    + '\n\n' + out.join('\n') + '\n\nBorrados: 0';
  Logger.log(msg);
  return msg;
}
