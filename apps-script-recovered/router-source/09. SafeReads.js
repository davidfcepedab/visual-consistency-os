/**
 * VISUAL IDENTITY OS — SAFE READ CONTRACT
 *
 * These handlers perform no writes, repairs, scoring, or image decisions.
 * Pagination and filtering remain in the MCP so this router returns one
 * revision-bound source snapshot per request.
 */

function handleSafeReadAction_(action, params) {
  try {
    if (action === 'capture') {
      return getCaptureExactSafe_(
        String(params.id || '')
      );
    }

    if (action === 'orphan_snapshot') {
      return getOrphanSnapshotSafe_();
    }

    if (action === 'batches_catalog') {
      return getBatchesCatalogSafe_();
    }

    return safeReadError_(
      'INVALID_ARGUMENT',
      'Unsupported read action',
      false
    );
  } catch (_error) {
    return safeReadError_(
      'BACKEND_ERROR',
      'Visual OS read request failed',
      true
    );
  }
}

function getCaptureExactSafe_(captureId) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(
      captureId
    )
  ) {
    return safeReadError_(
      'INVALID_ARGUMENT',
      'capture_id is invalid',
      false
    );
  }

  const captures = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.CAPTURES
  );

  const matches = captures.filter(
    capture =>
      String(capture.capture_id || '') ===
      captureId
  );

  if (!matches.length) {
    return safeReadError_(
      'NOT_FOUND',
      'Capture was not found',
      false
    );
  }

  if (matches.length > 1) {
    return safeReadError_(
      'CONFLICT',
      'capture_id is not unique',
      false
    );
  }

  return {
    ok: true,
    capture: matches[0],
  };
}

function getOrphanSnapshotSafe_() {
  const captures = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.CAPTURES
  );
  const batches = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.BATCHES
  );
  const requests = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.REQUESTS
  );
  const reviews = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.REVIEW_QUEUE
  ).map(normalizeCaptureReferenceSafe_);
  const resultMemory = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.RESULT_MEMORY
  ).map(normalizeCaptureReferenceSafe_);
  const assets = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.ASSET_REGISTRY
  ).map(normalizeCaptureReferenceSafe_);

  const snapshot = {
    captures,
    batches,
    requests,
    reviews,
    result_memory: resultMemory,
    assets,
  };

  snapshot.revision =
    revisionForSafeRead_(snapshot);

  return {
    ok: true,
    snapshot,
  };
}

function getBatchesCatalogSafe_() {
  const batches = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.BATCHES
  );
  const captures = readSheetRecordsSafe_(
    STATIC_CONFIG.SHEETS.CAPTURES
  );
  const seenBatchIds = {};

  for (const batch of batches) {
    const batchId = String(
      batch.batch_id || ''
    ).trim();

    if (!batchId) {
      return safeReadError_(
        'BACKEND_PROTOCOL_ERROR',
        'Batch without batch_id',
        false
      );
    }

    if (seenBatchIds[batchId]) {
      return safeReadError_(
        'CONFLICT',
        'Duplicate batch_id',
        false
      );
    }
    seenBatchIds[batchId] = true;
  }

  const catalog = batches.map(batch =>
    enrichBatchReadContextSafe_(
      batch,
      captures
    )
  );

  return {
    ok: true,
    revision: revisionForSafeRead_({
      batches: catalog,
      captures,
    }),
    batches: catalog,
  };
}

function enrichBatchReadContextSafe_(
  batch,
  captures
) {
  const batchId = String(
    batch.batch_id || ''
  );
  const linkedCaptures = captures.filter(
    capture =>
      String(capture.batch_id || '') ===
      batchId
  );

  const projects = uniqueNonEmptySafe_(
    linkedCaptures.map(
      capture => capture.project
    )
  );
  const linkedProjectValues =
    linkedCaptures.map(
      capture =>
        String(
          capture.project || ''
        ).trim()
    );

  const subjects = uniqueNonEmptySafe_(
    linkedCaptures.flatMap(
      capture =>
        splitSubjectsSafe_(
          capture.identity_subjects ||
          capture.subjects
        )
    )
  );
  const existingProject = String(
    batch.project || ''
  ).trim();
  const existingSubjects =
    splitSubjectsSafe_(batch.subjects);
  const derivedProject =
    linkedProjectValues.length > 0 &&
    linkedProjectValues.every(Boolean) &&
    projects.length === 1
      ? projects[0]
      : '';

  return Object.assign({}, batch, {
    project:
      existingProject ||
      derivedProject,
    project_verification_status:
      existingProject
        ? 'VERIFIED_SOURCE'
        : derivedProject
          ? 'CANDIDATE'
          : 'UNKNOWN',
    subjects:
      existingSubjects.length
        ? batch.subjects
        : subjects,
    subjects_verification_status:
      existingSubjects.length
        ? 'VERIFIED_SOURCE'
        : subjects.length
          ? 'CANDIDATE'
          : 'UNKNOWN',
  });
}

function readSheetRecordsSafe_(sheetName) {
  const sheet = getSheet_(sheetName);
  const data = sheet
    .getDataRange()
    .getValues();

  if (!data.length) {
    return [];
  }

  const headers = data[0].map(
    header => String(header || '').trim()
  );
  const seenHeaders = {};

  for (const header of headers) {
    if (!header) {
      throw new Error(
        'Empty sheet header'
      );
    }
    if (seenHeaders[header]) {
      throw new Error(
        'Duplicate sheet header'
      );
    }
    seenHeaders[header] = true;
  }

  return data
    .slice(1)
    .filter(row =>
      row.some(
        value =>
          String(value || '').trim() !== ''
      )
    )
    .map(row =>
      Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            row[index],
          ]
        )
      )
    );
}

function normalizeCaptureReferenceSafe_(
  record
) {
  if (record.capture_id) {
    return record;
  }

  const sourceCaptureId = String(
    record.source_capture_id || ''
  ).trim();

  if (!sourceCaptureId) {
    return record;
  }

  return Object.assign({}, record, {
    capture_id: sourceCaptureId,
  });
}

function splitSubjectsSafe_(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  return String(value || '')
    .split(/\s*(?:\||\+|,)\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueNonEmptySafe_(values) {
  return Array.from(
    new Set(
      values
        .map(value =>
          String(value || '').trim()
        )
        .filter(Boolean)
    )
  ).sort();
}

function revisionForSafeRead_(payload) {
  const canonical = JSON.stringify(
    canonicalizeSafeRead_(payload)
  );

  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    canonical
  );

  const hex = digest
    .map(byte =>
      ((byte + 256) % 256)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');

  return `sheet-${hex}`;
}

function canonicalizeSafeRead_(value) {
  if (Array.isArray(value)) {
    return value.map(
      canonicalizeSafeRead_
    );
  }

  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date)
  ) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] =
          canonicalizeSafeRead_(
            value[key]
          );
        return result;
      }, {});
  }

  return value;
}

function safeReadError_(
  code,
  message,
  retryable
) {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: Boolean(retryable),
    },
  };
}
