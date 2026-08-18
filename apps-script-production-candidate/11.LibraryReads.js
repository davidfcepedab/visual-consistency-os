/**
 * VISUAL IDENTITY OS — LIBRARY MAINTENANCE READS
 *
 * Returns a bounded, revisioned snapshot for deterministic dry-run planning.
 * This file contains no write, move, rename, scoring, or decision operations.
 */

function getLibraryMaintenanceSnapshotSafe_() {
  try {
    const files = [];
    collectLibraryFilesSafe_(
      STATIC_CONFIG.FOLDERS.INBOX,
      'INBOX',
      files
    );
    collectLibraryFilesSafe_(
      STATIC_CONFIG.FOLDERS.LIBRARY_ORGANIZED,
      'LIBRARY',
      files
    );

    const captures = readSheetRecordsSafe_(
      STATIC_CONFIG.SHEETS.CAPTURES
    );
    const resultMemory = readSheetRecordsSafe_(
      STATIC_CONFIG.SHEETS.RESULT_MEMORY
    );
    const assetRegistry = readSheetRecordsSafe_(
      STATIC_CONFIG.SHEETS.ASSET_REGISTRY
    );
    const assetIndex = readExternalSheetRecordsSafe_(
      STATIC_CONFIG.PROMPT_GENERATOR_SPREADSHEET_ID,
      STATIC_CONFIG.SHEETS.ASSET_INDEX
    );

    const snapshot = {
      files: uniqueLibraryFilesSafe_(files),
      captures,
      result_memory: resultMemory,
      asset_registry: assetRegistry,
      asset_index: assetIndex,
      reference_checks: checkLibraryReferencesSafe_(
      assetRegistry,
        assetIndex,
        files
      ),
      scan: {
        file_limit: 2500,
        truncated: files.length >= 2500,
      },
    };
    snapshot.revision = revisionForSafeRead_(snapshot)
      .replace('sheet-', 'library-');

    return {
      ok: true,
      snapshot,
    };
  } catch (_error) {
    return safeReadError_(
      'BACKEND_ERROR',
      'Visual library snapshot failed',
      true
    );
  }
}

function collectLibraryFilesSafe_(
  rootFolderId,
  scope,
  output
) {
  const maxFiles = 2500;
  const maxDepth = 8;
  const root = DriveApp.getFolderById(rootFolderId);
  const pending = [{
    folder: root,
    path: root.getName(),
    depth: 0,
  }];
  const seenFolders = {};

  while (pending.length && output.length < maxFiles) {
    const current = pending.shift();
    const folderId = String(current.folder.getId());
    if (seenFolders[folderId]) continue;
    seenFolders[folderId] = true;

    const fileIterator = current.folder.getFiles();
    while (fileIterator.hasNext() && output.length < maxFiles) {
      const file = fileIterator.next();
      output.push({
        file_id: String(file.getId()),
        name: String(file.getName()),
        mime_type: String(file.getMimeType()),
        modified_at: file.getLastUpdated().toISOString(),
        size: Number(file.getSize() || 0),
        parent_id: folderId,
        path: `${current.path}/${file.getName()}`,
        scope,
      });
    }

    if (current.depth >= maxDepth) continue;
    const folderIterator = current.folder.getFolders();
    while (folderIterator.hasNext()) {
      const child = folderIterator.next();
      pending.push({
        folder: child,
        path: `${current.path}/${child.getName()}`,
        depth: current.depth + 1,
      });
    }
  }
}

function uniqueLibraryFilesSafe_(files) {
  const byId = {};
  files.forEach(file => {
    if (!byId[file.file_id]) {
      byId[file.file_id] = file;
    }
  });
  return Object.keys(byId)
    .sort()
    .map(fileId => byId[fileId]);
}

function readExternalSheetRecordsSafe_(
  spreadsheetId,
  sheetName
) {
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Required external sheet is missing');
  }
  const data = sheet.getDataRange().getValues();
  if (!data.length) return [];
  const headers = data[0].map(
    header => String(header || '').trim()
  );
  return data.slice(1)
    .filter(row => row.some(value => String(value || '').trim()))
    .map(row => Object.fromEntries(
      headers.map((header, index) => [header, row[index]])
    ));
}

function checkLibraryReferencesSafe_(
  assetRegistry,
  assetIndex,
  scannedFiles
) {
  const references = [];
  assetRegistry.forEach(record => {
    const fileId = firstDriveIdSafe_([
      record.source_file_id,
      record.file_id,
      record.drive_url,
    ]);
    if (fileId) references.push({
      file_id: fileId,
      source: 'ASSET_REGISTRY',
    });
  });
  assetIndex.forEach(record => {
    const fileId = firstDriveIdSafe_([
      record['Drive Link'],
      record.drive_url,
      record.file_id,
    ]);
    if (fileId) references.push({
      file_id: fileId,
      source: 'ASSET_INDEX',
    });
  });

  const seen = {};
  const scannedIds = {};
  scannedFiles.forEach(file => {
    scannedIds[String(file.file_id)] = true;
  });
  return references
    .filter(reference => {
      const key = `${reference.source}|${reference.file_id}`;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    })
    .map(reference => Object.assign({}, reference, {
      // A missing ID in the bounded scan is UNKNOWN, never proof of deletion.
      state: scannedIds[reference.file_id]
        ? 'EXISTS'
        : 'UNAVAILABLE',
    }));
}

function firstDriveIdSafe_(values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const pathMatch = text.match(/\/d\/([A-Za-z0-9_-]+)/);
    const queryMatch = text.match(/[?&]id=([A-Za-z0-9_-]+)/);
    const fileId = pathMatch
      ? pathMatch[1]
      : queryMatch
        ? queryMatch[1]
        : /^[A-Za-z0-9_-]+$/.test(text)
          ? text
          : '';
    if (fileId) return fileId;
  }
  return '';
}
