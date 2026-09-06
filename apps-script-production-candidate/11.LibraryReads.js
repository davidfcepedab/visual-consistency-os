/**
 * VISUAL IDENTITY OS — LIBRARY MAINTENANCE READS
 *
 * Cursor-based, exhaustive traversal of the configured Inbox, organized
 * library and Reference Packs roots using the Drive v3 advanced service (Drive.Files.list
 * with pageToken). Replaces the old 2500-file bounded, single-call scan:
 * every call returns exactly one page plus a next_cursor; the caller must
 * keep calling with that cursor until `complete: true` to see the whole
 * tree. There is no artificial cap — coverage is only ever COMPLETE (every
 * page consumed) or the call fails outright with a retryable error. This
 * file performs no write, move, rename, scoring, or decision operations.
 *
 * Cursor contents (folder queue, current folder's Drive pageToken, visited
 * folder ids, running counters) travel in the cursor string itself. Sheets
 * are hashed at scan start and re-read on the final page; a revision change
 * aborts the scan rather than mixing two datasets.
 */

const LIBRARY_SCAN_DEFAULT_PAGE_SIZE = 500;
const LIBRARY_SCAN_MAX_PAGE_SIZE = 1000;

function getLibraryMaintenanceSnapshotPageSafe_(cursorToken, requestedPageSize) {
  try {
    const pageSize = clampLibraryScanPageSize_(requestedPageSize);
    let state = cursorToken
      ? decodeLibraryScanCursor_(cursorToken)
      : null;

    if (!state) {
      state = startLibraryScan_();
    }

    const pageFiles = [];
    while (pageFiles.length < pageSize) {
      if (state.currentFolder) {
        advanceCurrentFolder_(state, pageFiles, pageSize);
        continue;
      }
      if (!state.pendingFolders.length) break;
      const next = state.pendingFolders.shift();
      if (state.visitedFolderIds[next.folderId]) continue;
      state.visitedFolderIds[next.folderId] = true;
      state.currentFolder = next;
      state.currentFolderPageToken = null;
    }

    state.pagesScanned += 1;
    const complete = !state.currentFolder && !state.pendingFolders.length;

    const result = {
      ok: true,
      scan_id: state.scanId,
      revision: state.revision,
      files: pageFiles,
      complete,
      truncated: false,
      coverage: complete ? 'COMPLETE' : 'PARTIAL',
      pages_scanned: state.pagesScanned,
      folders_scanned: state.foldersScanned,
      files_scanned: state.filesScanned,
      next_cursor: complete ? null : encodeLibraryScanCursor_(state),
    };

    if (complete) {
      Object.assign(result, finishLibraryScan_(state));
    }

    return result;
  } catch (_error) {
    const knownStage = [
      'INVALID_LIBRARY_SCAN_CURSOR_BASE64',
      'INVALID_LIBRARY_SCAN_CURSOR_GZIP',
      'INVALID_LIBRARY_SCAN_CURSOR_JSON',
      'INVALID_LIBRARY_SCAN_CURSOR_SHAPE',
      'LIBRARY_SCAN_REVISION_CHANGED',
    ].includes(String(_error && _error.message))
      ? String(_error.message)
      : 'LIBRARY_SCAN_RUNTIME';
    const response = safeReadError_(
      'BACKEND_ERROR',
      'Visual library scan page failed',
      true
    );
    response.diagnostic_stage = knownStage;
    return response;
  }
}

function clampLibraryScanPageSize_(requested) {
  const parsed = Number(requested);
  if (!parsed || parsed <= 0) return LIBRARY_SCAN_DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(LIBRARY_SCAN_MAX_PAGE_SIZE, Math.floor(parsed)));
}

function startLibraryScan_() {
  const captures = readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.CAPTURES);
  const resultMemory = readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.RESULT_MEMORY);
  const assetRegistry = readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.ASSET_REGISTRY);
  const assetIndex = readExternalSheetRecordsSafe_(
    STATIC_CONFIG.PROMPT_GENERATOR_SPREADSHEET_ID,
    STATIC_CONFIG.SHEETS.ASSET_INDEX
  );

  const sheets = {
    captures,
    result_memory: resultMemory,
    asset_registry: assetRegistry,
    asset_index: assetIndex,
  };
  const revision = revisionForSafeRead_(sheets).replace('sheet-', 'library-');
  const scanId = `scan-${Utilities.getUuid()}`;

  const inboxRoot = DriveApp.getFolderById(STATIC_CONFIG.FOLDERS.INBOX);
  const libraryRoot = DriveApp.getFolderById(STATIC_CONFIG.FOLDERS.LIBRARY_ORGANIZED);
  const referenceRoot = DriveApp.getFolderById(STATIC_CONFIG.FOLDERS.REFERENCE_PACKS);

  return {
    scanId,
    revision,
    pendingFolders: [
      { folderId: STATIC_CONFIG.FOLDERS.INBOX, path: inboxRoot.getName(), depth: 0, scope: 'INBOX' },
      { folderId: STATIC_CONFIG.FOLDERS.LIBRARY_ORGANIZED, path: libraryRoot.getName(), depth: 0, scope: 'LIBRARY' },
      { folderId: STATIC_CONFIG.FOLDERS.REFERENCE_PACKS, path: referenceRoot.getName(), depth: 0, scope: 'LIBRARY' },
    ],
    currentFolder: null,
    currentFolderPageToken: null,
    visitedFolderIds: {},
    pagesScanned: 0,
    foldersScanned: 0,
    filesScanned: 0,
  };
}

// Exhaustively lists the current folder's direct-child, non-folder files a
// page of Drive results at a time (Drive v3 `files.list` + pageToken), then
// enqueues the folder's direct subfolders exactly once before moving on.
function advanceCurrentFolder_(state, pageFiles, pageSize) {
  const current = state.currentFolder;
  const response = Drive.Files.list({
    q: `'${current.folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    pageSize: Math.max(1, Math.min(LIBRARY_SCAN_MAX_PAGE_SIZE, pageSize - pageFiles.length)),
    pageToken: state.currentFolderPageToken || undefined,
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  (response.files || []).forEach(file => {
    state.filesScanned += 1;
    pageFiles.push({
      file_id: String(file.id),
      name: String(file.name),
      mime_type: String(file.mimeType || ''),
      modified_at: file.modifiedTime || '',
      size: Number(file.size || 0),
      parent_id: current.folderId,
      path: `${current.path}/${file.name}`,
      scope: current.scope,
    });
  });

  state.currentFolderPageToken = response.nextPageToken || null;
  if (state.currentFolderPageToken) return;

  if (!current.subfoldersEnqueued) {
    enqueueLibraryScanSubfolders_(state, current);
    current.subfoldersEnqueued = true;
  }
  state.foldersScanned += 1;
  state.currentFolder = null;
}

function enqueueLibraryScanSubfolders_(state, current) {
  let pageToken;
  do {
    const response = Drive.Files.list({
      q: `'${current.folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      pageSize: LIBRARY_SCAN_MAX_PAGE_SIZE,
      pageToken,
      fields: 'nextPageToken, files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    (response.files || []).forEach(folder => {
      state.pendingFolders.push({
        folderId: String(folder.id),
        path: `${current.path}/${folder.name}`,
        depth: current.depth + 1,
        scope: current.scope,
      });
    });
    pageToken = response.nextPageToken;
  } while (pageToken);
}

// Called only on the final (complete) page. Re-reads the sheets and verifies
// their revision is unchanged across the traversal, then
// performs direct, per-file-id Drive existence checks for every reference —
// never inferring NOT_FOUND/EXISTS from mere absence in the scanned pages.
function finishLibraryScan_(state) {
  const sheets = {
    captures: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.CAPTURES),
    result_memory: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.RESULT_MEMORY),
    asset_registry: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.ASSET_REGISTRY),
    asset_index: readExternalSheetRecordsSafe_(
      STATIC_CONFIG.PROMPT_GENERATOR_SPREADSHEET_ID,
      STATIC_CONFIG.SHEETS.ASSET_INDEX
    ),
  };
  const finalRevision = revisionForSafeRead_(sheets)
    .replace('sheet-', 'library-');
  if (finalRevision !== state.revision) {
    throw new Error('LIBRARY_SCAN_REVISION_CHANGED');
  }

  return {
    captures: sheets.captures,
    result_memory: sheets.result_memory,
    asset_registry: sheets.asset_registry,
    asset_index: sheets.asset_index,
    reference_checks: checkLibraryReferencesDirect_(
      sheets.asset_registry,
      sheets.asset_index
    ),
    sheets_refreshed_after_cache_expiry: false,
  };
}

function encodeLibraryScanCursor_(state) {
  const payload = {
    scan_id: state.scanId,
    revision: state.revision,
    pending_folders: state.pendingFolders,
    current_folder: state.currentFolder,
    current_folder_page_token: state.currentFolderPageToken,
    visited_folder_ids: state.visitedFolderIds,
    pages_scanned: state.pagesScanned,
    folders_scanned: state.foldersScanned,
    files_scanned: state.filesScanned,
  };
  // The folder queue can be large. Gzip keeps the continuation cursor below
  // practical HTTP query-string limits without persisting scan state in
  // CacheService or PropertiesService (a read remains business-state free).
  const compressed = Utilities.gzip(
    Utilities.newBlob(JSON.stringify(payload), 'application/json')
  );
  return Utilities.base64EncodeWebSafe(compressed.getBytes());
}

function decodeLibraryScanCursor_(cursorToken) {
  let bytes;
  try {
    bytes = Utilities.base64DecodeWebSafe(cursorToken);
  } catch (_err) {
    throw new Error('INVALID_LIBRARY_SCAN_CURSOR_BASE64');
  }
  let uncompressed;
  try {
    uncompressed = Utilities.ungzip(
      Utilities.newBlob(bytes, 'application/x-gzip', 'library-cursor.gz')
    );
  } catch (_err) {
    throw new Error('INVALID_LIBRARY_SCAN_CURSOR_GZIP');
  }
  let payload;
  try {
    payload = JSON.parse(uncompressed.getDataAsString());
  } catch (_err) {
    throw new Error('INVALID_LIBRARY_SCAN_CURSOR_JSON');
  }
  if (!payload || typeof payload.scan_id !== 'string') {
    throw new Error('INVALID_LIBRARY_SCAN_CURSOR_SHAPE');
  }
  return {
    scanId: payload.scan_id,
    revision: payload.revision,
    pendingFolders: payload.pending_folders || [],
    currentFolder: payload.current_folder || null,
    currentFolderPageToken: payload.current_folder_page_token || null,
    visitedFolderIds: payload.visited_folder_ids || {},
    pagesScanned: payload.pages_scanned || 0,
    foldersScanned: payload.folders_scanned || 0,
    filesScanned: payload.files_scanned || 0,
  };
}

// Direct per-id Drive.Files.get probes. EXISTS/NOT_FOUND/UNAVAILABLE are the
// only three outcomes; a file simply not having appeared yet in a scan page
// is never treated as evidence of anything.
function checkLibraryReferencesDirect_(assetRegistry, assetIndex) {
  const refs = [];
  (assetRegistry || []).forEach(record => {
    const fileId = firstDriveIdSafe_([
      record.source_file_id,
      record.file_id,
      record.drive_url,
    ]);
    if (fileId) refs.push({ file_id: fileId, source: 'ASSET_REGISTRY' });
  });
  (assetIndex || []).forEach(record => {
    const fileId = firstDriveIdSafe_([
      record['Drive Link'],
      record.drive_url,
      record.file_id,
    ]);
    if (fileId) refs.push({ file_id: fileId, source: 'ASSET_INDEX' });
  });

  const seen = {};
  const unique = refs.filter(reference => {
    const key = `${reference.source}|${reference.file_id}`;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  return unique.map(reference => Object.assign({}, reference, {
    state: probeDriveFileStateSafe_(reference.file_id),
  }));
}

function probeDriveFileStateSafe_(fileId) {
  try {
    const meta = Drive.Files.get(fileId, {
      fields: 'id, trashed',
      supportsAllDrives: true,
    });
    return meta.trashed ? 'NOT_FOUND' : 'EXISTS';
  } catch (err) {
    const message = String((err && err.message) || err || '');
    if (/not found|404/i.test(message)) return 'NOT_FOUND';
    return 'UNAVAILABLE';
  }
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
