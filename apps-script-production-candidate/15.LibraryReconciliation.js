/**
 * VISUAL IDENTITY OS — APPLY LIBRARY RECONCILIATION (WRITE)
 *
 * Server-side counterpart of src/library-mutation-tools.ts'
 * planSafeLibraryMutations(). The TS layer has already decided exactly
 * which safe, deterministic write each action maps to and rejected
 * anything unprovable from the snapshot alone; this function's job is to
 * apply that plan defensively — re-checking the same allowlist and
 * expected_revision here rather than trusting the caller — and nothing
 * more:
 *   - Only ASSET_REGISTRY may be written. Never DriveApp move/rename/
 *     delete, never a new sheet, never a new folder.
 *   - Only APPEND_ROW (new CANDIDATE row) and APPEND_PROVENANCE (update an
 *     existing row's provenance_state/status from an already-proven human
 *     decision) are accepted operations.
 *   - Fields touching identity/face/tattoo/ring/Detail Lock/Identity
 *     Master/Publication Ready, or any human-decision field, are rejected
 *     even if somehow present in the plan.
 *   - expected_revision must match the current sheets-derived revision
 *     (the same hash visual_apply_library_reconciliation compares against
 *     on the read side) or the write is refused as CONFLICT.
 *   - idempotency_key replay returns the original result verbatim and
 *     performs zero additional writes.
 *   - Every write appends an audit provenance line rather than
 *     overwriting existing free-text evidence, and the response includes
 *     a readback of every row touched.
 */

const LIBRARY_RECON_FORBIDDEN_FIELD_PATTERN =
  /identity|face|tattoo|ring|detail_lock|identity_master|publication_ready/i;
const LIBRARY_RECON_HUMAN_DECISION_FIELDS = {
  human_decision: true,
  human_status: true,
  reviewed_by: true,
  approved_by: true,
};
const LIBRARY_RECON_ALLOWED_OPERATIONS = {
  APPEND_ROW: true,
  APPEND_PROVENANCE: true,
  NOOP_ALREADY_REGISTERED: true,
};
const LIBRARY_RECON_IDEMPOTENCY_PREFIX = 'library-recon-idem:';

function invalidLibraryReconArg_(message) {
  return Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
}

function applyLibraryReconciliation_(payload) {
  const idempotencyKey = String(payload.idempotency_key || '').trim();
  if (!idempotencyKey) {
    throw invalidLibraryReconArg_('idempotency_key is required');
  }
  const expectedRevision = String(payload.expected_revision || '').trim();
  if (!expectedRevision) {
    throw invalidLibraryReconArg_('expected_revision is required');
  }
  const mutations = Array.isArray(payload.mutations) ? payload.mutations : [];
  const requestFingerprint = revisionForSafeRead_({
    expected_revision: expectedRevision,
    actions: Array.isArray(payload.actions) ? payload.actions : [],
  });

  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const idemKey = `${LIBRARY_RECON_IDEMPOTENCY_PREFIX}${idempotencyKey}`;
    const existingRaw = props.getProperty(idemKey);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      if (existing.request_fingerprint !== requestFingerprint) {
        throw invalidLibraryReconArg_(
          'idempotency_key was already used for a different reconciliation request'
        );
      }
      return Object.assign({}, existing.response, { idempotent_replay: true });
    }
    if (payload.replay_only === true) {
      throw Object.assign(new Error('No prior reconciliation for idempotency_key'), {
        code: 'NOT_FOUND',
      });
    }

    const registrySheet = getSheet_(STATIC_CONFIG.SHEETS.ASSET_REGISTRY);
    const currentSheets = {
      captures: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.CAPTURES),
      result_memory: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.RESULT_MEMORY),
      asset_registry: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.ASSET_REGISTRY),
      asset_index: readExternalSheetRecordsSafe_(
        STATIC_CONFIG.PROMPT_GENERATOR_SPREADSHEET_ID,
        STATIC_CONFIG.SHEETS.ASSET_INDEX
      ),
    };
    const beforeRevision = revisionForSafeRead_(currentSheets)
      .replace('sheet-', 'library-');
    if (beforeRevision !== expectedRevision) {
      throw Object.assign(
        new Error(
          `expected_revision does not match the current library revision (${beforeRevision})`
        ),
        { code: 'CONFLICT' }
      );
    }

    const auditedAt = nowIso_();
    const actor = String(payload.updated_by || '').trim() || 'unknown';
    const reason = String(payload.reason || '').trim();
    const sourceEvidence = Array.isArray(payload.source_evidence)
      ? payload.source_evidence
      : [];
    const results = [];
    const registeredDuringRequest = {};
    let writeCount = 0;

    mutations.forEach(mutation => {
      if (!LIBRARY_RECON_ALLOWED_OPERATIONS[mutation.operation]) {
        throw invalidLibraryReconArg_(`Operation not permitted: ${mutation.operation}`);
      }
      if (mutation.target !== 'ASSET_REGISTRY') {
        throw invalidLibraryReconArg_(`Target not permitted: ${mutation.target}`);
      }
      assertSafeLibraryReconFields_(mutation.fields || {});

      if (mutation.operation === 'NOOP_ALREADY_REGISTERED') {
        results.push({
          type: mutation.type,
          file_id: mutation.file_id,
          operation: mutation.operation,
          applied: false,
        });
        return;
      }

      const provenanceLine =
        `RECONCILIATION ${auditedAt} by ${actor} (${mutation.type}, ` +
        `trace=${payload.trace_id || 'n/a'}): ${reason || 'no reason given'}. ` +
        `source_evidence=${JSON.stringify(sourceEvidence)}; ` +
        `plan_evidence=${JSON.stringify(mutation.evidence || [])}.`;

      if (mutation.operation === 'APPEND_ROW') {
        const fileId = String(mutation.file_id || '').trim();
        const alreadyRegistered = currentSheets.asset_registry
          .concat(currentSheets.asset_index)
          .some(record => firstDriveIdSafe_([
            record.source_file_id,
            record.file_id,
            record.drive_url,
            record['Drive Link'],
          ]) === fileId);
        if (alreadyRegistered || registeredDuringRequest[fileId]) {
          results.push({
            type: mutation.type,
            file_id: fileId,
            operation: 'NOOP_ALREADY_REGISTERED',
            applied: false,
          });
          return;
        }
        const rowFields = Object.assign({}, mutation.fields, {
          asset_id: String(mutation.fields.asset_id || `LIB-${fileId}`),
          created_at: auditedAt,
          approval_notes: provenanceLine,
        });
        const row = appendObject_(registrySheet, rowFields);
        registeredDuringRequest[fileId] = true;
        writeCount += 1;
        results.push({
          type: mutation.type,
          file_id: mutation.file_id,
          operation: mutation.operation,
          applied: true,
          row,
          after: rowObject_(registrySheet, row),
        });
        return;
      }

      // APPEND_PROVENANCE
      const assetId = mutation.match && mutation.match.asset_id;
      if (!assetId) {
        throw invalidLibraryReconArg_('APPEND_PROVENANCE requires an exact match.asset_id');
      }
      const row = findRowByColumnValueSafe_(registrySheet, 'asset_id', assetId);
      if (row === -1) {
        throw invalidLibraryReconArg_(`No exact ASSET_REGISTRY row for asset_id=${assetId}`);
      }
      const before = rowObject_(registrySheet, row);
      const exactHumanDecision = currentSheets.captures.some(capture => {
        const status = String(capture.status || '').trim().toUpperCase();
        return String(capture.capture_id || '').trim() === String(mutation.capture_id || '').trim() &&
          firstDriveIdSafe_([capture.file_id, capture.drive_url, capture.asset_link]) ===
            String(mutation.file_id || '').trim() &&
          (status === 'APPROVED' || status === 'REJECTED');
      });
      if (!exactHumanDecision) {
        throw invalidLibraryReconArg_(
          `No current exact human APPROVED/REJECTED decision for capture_id=${mutation.capture_id}`
        );
      }
      const headers = headerMap_(registrySheet);
      const notesHeader = ['approval_notes', 'notes', 'evidence'].find(name => headers[name]);
      const priorNotes = notesHeader ? String(before[notesHeader] || '') : '';
      Object.keys(mutation.fields || {}).forEach(field => {
        if (headers[field]) {
          setCellByHeader_(registrySheet, row, field, mutation.fields[field]);
        }
      });
      if (notesHeader) {
        setCellByHeader_(
          registrySheet,
          row,
          notesHeader,
          priorNotes ? `${priorNotes} | ${provenanceLine}` : provenanceLine
        );
      }
      writeCount += 1;
      results.push({
        type: mutation.type,
        file_id: mutation.file_id,
        operation: mutation.operation,
        applied: true,
        row,
        before,
        after: rowObject_(registrySheet, row),
      });
    });

    const afterSheets = {
      captures: currentSheets.captures,
      result_memory: currentSheets.result_memory,
      asset_registry: readSheetRecordsSafe_(STATIC_CONFIG.SHEETS.ASSET_REGISTRY),
      asset_index: currentSheets.asset_index,
    };
    const afterRevision = revisionForSafeRead_(afterSheets)
      .replace('sheet-', 'library-');

    const response = {
      ok: true,
      applied: writeCount > 0,
      write_count: writeCount,
      before_revision: beforeRevision,
      revision: afterRevision,
      results,
      idempotent_replay: false,
    };

    props.setProperty(idemKey, JSON.stringify({
      request_fingerprint: requestFingerprint,
      response,
    }));

    return response;
  });
}

function assertSafeLibraryReconFields_(fields) {
  Object.keys(fields || {}).forEach(key => {
    if (LIBRARY_RECON_FORBIDDEN_FIELD_PATTERN.test(key)) {
      throw invalidLibraryReconArg_(`Field not permitted for automatic library reconciliation: ${key}`);
    }
    if (LIBRARY_RECON_HUMAN_DECISION_FIELDS[key]) {
      throw invalidLibraryReconArg_(`Field is a human-decision field and cannot be set automatically: ${key}`);
    }
  });
}

function findRowByColumnValueSafe_(sheet, header, value) {
  const headers = headerMap_(sheet);
  const col = headers[header];
  if (!col) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || '').trim() === String(value).trim()) {
      return i + 2;
    }
  }
  return -1;
}
