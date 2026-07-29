function doGet(e) {
  try {
    assertSharedSecret_(e);

    const action = String(
      e?.parameter?.action || 'status'
    ).trim();

    switch (action) {
      case 'status':
        return jsonResponse_(getSystemStatus_());

      case 'batches':
        return jsonResponse_(listPendingBatches_());

      case 'batch':
        return jsonResponse_(
          getBatchDetail_(
            String(e?.parameter?.id || '')
          )
        );

      case 'captures':
        return jsonResponse_(
          listRecentCaptures_(
            Number(e?.parameter?.limit || 50)
          )
        );

      case 'capture':
      case 'orphan_snapshot':
      case 'batches_catalog':
        return jsonResponse_(
          handleSafeReadAction_(
            action,
            e?.parameter || {}
          )
        );

      case 'active_session':
        return jsonResponse_(getActiveVisualSession_());

      case 'validate_schema':
        return jsonResponse_(validateVisualSchema_());

      default:
        return jsonResponse_({
          ok: false,
          error: `Unsupported action: ${action}`,
        });
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err.message || err),
    });
  }
}

function doPost(e) {
  try {
    assertSharedSecret_(e);

    const payload = parseJsonBody_(e);
    const action = String(
      payload.action || ''
    ).trim();

    switch (action) {
      case 'create_session':
        return jsonResponse_(
          createVisualSession_(payload)
        );

      case 'close_session':
        return jsonResponse_(
          closeVisualSession_(payload)
        );

      case 'create_request':
        return jsonResponse_(
          createFormalRequest_(payload)
        );

      case 'cancel_request':
        return jsonResponse_(
          cancelFormalRequest_(payload)
        );

      case 'submit_decision':
        return jsonResponse_(
          submitCaptureDecision_(payload)
        );

      case 'promote_asset':
        return jsonResponse_(
          promoteAsset_(payload)
        );

      case 'run_pipeline':
        return jsonResponse_({
          ok: true,
          result: runUniversalInboxPipeline(),
        });

      default:
        return jsonResponse_({
          ok: false,
          error: `Unsupported action: ${action}`,
        });
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: String(err.message || err),
    });
  }
}

function getSystemStatus_() {
  const ss = SpreadsheetApp.openById(
    STATIC_CONFIG.SPREADSHEET_ID
  );

  return {
    ok: true,
    service: 'Visual Identity OS',
    timestamp: nowIso_(),

    counts: {
      captures: countRows_(
        ss.getSheetByName(
          STATIC_CONFIG.SHEETS.CAPTURES
        )
      ),

      batches: countRows_(
        ss.getSheetByName(
          STATIC_CONFIG.SHEETS.BATCHES
        )
      ),

      review_queue: countRows_(
        ss.getSheetByName(
          STATIC_CONFIG.SHEETS.REVIEW_QUEUE
        )
      ),

      result_memory: countRows_(
        ss.getSheetByName(
          STATIC_CONFIG.SHEETS.RESULT_MEMORY
        )
      ),

      assets: countRows_(
        ss.getSheetByName(
          STATIC_CONFIG.SHEETS.ASSET_REGISTRY
        )
      ),

      failures: countRows_(
        ss.getSheetByName(
          STATIC_CONFIG.SHEETS.FAILURE_MEMORY
        )
      ),
    },

    folders: {
      inbox: STATIC_CONFIG.FOLDERS.INBOX,
      human_review:
        STATIC_CONFIG.FOLDERS.HUMAN_REVIEW,
      adjustment:
        STATIC_CONFIG.FOLDERS.ADJUSTMENT,
      approved:
        STATIC_CONFIG.FOLDERS.APPROVED,
      rejected:
        STATIC_CONFIG.FOLDERS.REJECTED,
    },
  };
}

function listPendingBatches_() {
  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.BATCHES
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    return {
      ok: true,
      batches: [],
    };
  }

  const headers = data[0];

  const batches = data
    .slice(1)
    .map(row =>
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          row[index],
        ])
      )
    )
    .filter(batch => {
      const status = String(
        batch.status || ''
      ).toUpperCase();

      return [
        'READY_TO_SCORE',
        'SCORING',
        'REVIEW_READY',
        'ERROR',
      ].includes(status);
    });

  return {
    ok: true,
    batches,
  };
}

function getBatchDetail_(batchId) {
  if (!batchId) {
    throw new Error('batch id is required');
  }

  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.BATCHES
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    throw new Error(
      `Batch not found: ${batchId}`
    );
  }

  const headers = data[0];

  const batch = data
    .slice(1)
    .map(row =>
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          row[index],
        ])
      )
    )
    .find(
      item =>
        String(item.batch_id) ===
        String(batchId)
    );

  if (!batch) {
    throw new Error(
      `Batch not found: ${batchId}`
    );
  }

  return {
    ok: true,
    batch,
    captures: getCapturesForBatch_(batchId),
  };
}

function listRecentCaptures_(limit) {
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit || 50), 200)
  );

  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.CAPTURES
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    return {
      ok: true,
      captures: [],
    };
  }

  const headers = data[0];

  const captures = data
    .slice(1)
    .filter(row =>
      row.some(
        cell =>
          String(cell || '').trim() !== ''
      )
    )
    .slice(-safeLimit)
    .reverse()
    .map(row =>
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          row[index],
        ])
      )
    );

  return {
    ok: true,
    captures,
  };
}

function createVisualSession_(payload) {
  const project = String(
    payload.project || ''
  ).trim();

  const subjects = Array.isArray(
    payload.subjects
  )
    ? payload.subjects.map(String)
    : [];

  const scene = String(
    payload.scene || ''
  ).trim();

  const generator = String(
    payload.generator || 'OTHER'
  )
    .trim()
    .toUpperCase();

  if (!project) {
    throw new Error('project is required');
  }

  if (!subjects.length) {
    throw new Error('subjects are required');
  }

  const sessionId = newId_('SES');
  const startedAt = nowIso_();

  PropertiesService
    .getScriptProperties()
    .setProperties(
      {
        ACTIVE_VISUAL_SESSION_ID:
          sessionId,

        ACTIVE_VISUAL_SESSION_PROJECT:
          project,

        ACTIVE_VISUAL_SESSION_SUBJECTS:
          subjects.join(' + '),

        ACTIVE_VISUAL_SESSION_SCENE:
          scene,

        ACTIVE_VISUAL_SESSION_GENERATOR:
          generator,

        ACTIVE_VISUAL_SESSION_STARTED_AT:
          startedAt,
      },
      false
    );

  return {
    ok: true,
    session: {
      session_id: sessionId,
      project,
      subjects,
      scene,
      generator,
      status: 'ACTIVE',
      started_at: startedAt,
    },
  };
}

function closeVisualSession_(payload) {
  const requestedSessionId = String(
    payload.session_id || ''
  ).trim();

  if (!requestedSessionId) {
    throw new Error('session_id is required');
  }

  const props = PropertiesService
    .getScriptProperties();

  const propertyKeys = [
    'ACTIVE_VISUAL_SESSION_ID',
    'ACTIVE_VISUAL_SESSION_PROJECT',
    'ACTIVE_VISUAL_SESSION_SUBJECTS',
    'ACTIVE_VISUAL_SESSION_SCENE',
    'ACTIVE_VISUAL_SESSION_GENERATOR',
    'ACTIVE_VISUAL_SESSION_STARTED_AT',
  ];

  const activeSessionId = String(
    props.getProperty(
      'ACTIVE_VISUAL_SESSION_ID'
    ) || ''
  ).trim();

  if (!activeSessionId) {
    return {
      ok: true,
      closed: false,
      session: {
        session_id: requestedSessionId,
        status: 'ALREADY_CLOSED',
      },
    };
  }

  if (activeSessionId !== requestedSessionId) {
    throw new Error(
      `Active session mismatch: ${requestedSessionId}`
    );
  }

  const closedSession = {
    session_id: activeSessionId,
    project: String(
      props.getProperty(
        'ACTIVE_VISUAL_SESSION_PROJECT'
      ) || ''
    ),
    subjects: String(
      props.getProperty(
        'ACTIVE_VISUAL_SESSION_SUBJECTS'
      ) || ''
    ),
    scene: String(
      props.getProperty(
        'ACTIVE_VISUAL_SESSION_SCENE'
      ) || ''
    ),
    generator: String(
      props.getProperty(
        'ACTIVE_VISUAL_SESSION_GENERATOR'
      ) || ''
    ),
    started_at: String(
      props.getProperty(
        'ACTIVE_VISUAL_SESSION_STARTED_AT'
      ) || ''
    ),
    closed_at: nowIso_(),
    closed_by: String(
      payload.closed_by || 'David'
    ).trim(),
    notes: String(
      payload.notes || ''
    ).trim(),
    status: 'CLOSED',
  };

  propertyKeys.forEach(key =>
    props.deleteProperty(key)
  );

  return {
    ok: true,
    closed: true,
    session: closedSession,
  };
}

function createFormalRequest_(payload) {
  const project = String(
    payload.project || ''
  ).trim();

  const subjects = Array.isArray(
    payload.subjects
  )
    ? payload.subjects
        .map(String)
        .join(' + ')
    : String(
        payload.subjects || ''
      ).trim();

  const prompt = String(
    payload.prompt || ''
  ).trim();

  if (!project) {
    throw new Error('project is required');
  }

  if (!subjects) {
    throw new Error('subjects are required');
  }

  if (!prompt) {
    throw new Error('prompt is required');
  }

  const requestId = newId_('REQ');

  appendObject_(
    getSheet_(
      STATIC_CONFIG.SHEETS.REQUESTS
    ),
    {
      request_id: requestId,
      created_at: nowIso_(),
      status: 'READY_TO_GENERATE',
      project,
      subjects,
      scene: String(
        payload.scene || ''
      ),
      mode: String(
        payload.mode ||
          'MANUAL_GENERATION'
      ),
      mechanism: String(
        payload.generator || 'OTHER'
      ),
      pack_version: String(
        payload.pack_version || ''
      ),
      prompt,
      parent_request_id: String(
        payload.parent_request_id || ''
      ),
      source_result_id: String(
        payload.source_result_id || ''
      ),
      iteration: Number(
        payload.iteration || 1
      ),
      notes: String(
        payload.notes || ''
      ),
    }
  );

  return {
    ok: true,
    request: {
      request_id: requestId,
      status: 'READY_TO_GENERATE',

      expected_filename:
        `${requestId} - ` +
        `${sanitizeVisibleName_(project)} - ` +
        `v01.png`,
    },
  };
}

function cancelFormalRequest_(payload) {
  const requestId = String(
    payload.request_id || ''
  ).trim();

  if (!requestId) {
    throw new Error('request_id is required');
  }

  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.REQUESTS
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    throw new Error(
      `Request not found: ${requestId}`
    );
  }

  const headers = data[0];
  const indexes = indexHeaders_(headers);

  if (
    indexes.request_id === undefined ||
    indexes.status === undefined
  ) {
    throw new Error(
      'REQUESTS sheet is missing required headers'
    );
  }

  let rowNumber = -1;
  let request = null;

  for (
    let rowIndex = 1;
    rowIndex < data.length;
    rowIndex++
  ) {
    if (
      String(
        data[rowIndex][
          indexes.request_id
        ] || ''
      ) === requestId
    ) {
      rowNumber = rowIndex + 1;
      request = Object.fromEntries(
        headers.map(
          (header, index) => [
            header,
            data[rowIndex][index],
          ]
        )
      );
      break;
    }
  }

  if (!request) {
    throw new Error(
      `Request not found: ${requestId}`
    );
  }

  const currentStatus = String(
    request.status || ''
  )
    .trim()
    .toUpperCase();

  if (
    [
      'CANCELLED',
      'CANCELLED_TEST',
    ].includes(currentStatus)
  ) {
    return {
      ok: true,
      cancelled: false,
      request: {
        request_id: requestId,
        previous_status: currentStatus,
        status: currentStatus,
      },
    };
  }

  const cancellableStatuses = [
    '',
    'REQUESTED',
    'READY_TO_GENERATE',
  ];

  if (
    !cancellableStatuses.includes(
      currentStatus
    )
  ) {
    throw new Error(
      `Request cannot be cancelled from status: ${currentStatus}`
    );
  }

  const linkedRecords = {
    captures: countRequestReferences_(
      STATIC_CONFIG.SHEETS.CAPTURES,
      requestId
    ),
    review_queue: countRequestReferences_(
      STATIC_CONFIG.SHEETS.REVIEW_QUEUE,
      requestId
    ),
    result_memory: countRequestReferences_(
      STATIC_CONFIG.SHEETS.RESULT_MEMORY,
      requestId
    ),
  };

  const linkedRecordCount =
    linkedRecords.captures +
    linkedRecords.review_queue +
    linkedRecords.result_memory;

  if (linkedRecordCount > 0) {
    throw new Error(
      `Request has linked records and cannot be cancelled: ${requestId}`
    );
  }

  const project = String(
    request.project || ''
  )
    .trim()
    .toUpperCase();

  const nextStatus =
    project.startsWith('TEST-')
      ? 'CANCELLED_TEST'
      : 'CANCELLED';

  const cancelledAt = nowIso_();
  const reason = String(
    payload.reason ||
      payload.notes ||
      'Cancelled via MCP'
  ).trim();

  const previousNotes = String(
    request.notes || ''
  ).trim();

  const auditNote =
    `[${cancelledAt}] ` +
    `Cancelled by ${String(
      payload.cancelled_by || 'David'
    ).trim()}: ${reason}`;

  setCellByHeader_(
    sheet,
    rowNumber,
    'status',
    nextStatus
  );

  setCellByHeader_(
    sheet,
    rowNumber,
    'notes',
    [previousNotes, auditNote]
      .filter(Boolean)
      .join('\n')
  );

  return {
    ok: true,
    cancelled: true,
    request: {
      request_id: requestId,
      previous_status: currentStatus,
      status: nextStatus,
      cancelled_at: cancelledAt,
      cancelled_by: String(
        payload.cancelled_by || 'David'
      ).trim(),
      reason,
    },
  };
}

function countRequestReferences_(
  sheetName,
  requestId
) {
  const sheet = getSheet_(sheetName);
  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    return 0;
  }

  const headers = data[0];
  const indexes = indexHeaders_(headers);

  if (indexes.request_id === undefined) {
    return 0;
  }

  return data
    .slice(1)
    .filter(
      row =>
        String(
          row[indexes.request_id] || ''
        ) === requestId
    )
    .length;
}

function submitCaptureDecision_(payload) {
  const captureId = String(payload.capture_id || '').trim();
  const decision = String(payload.decision || '').trim().toUpperCase();

  if (!captureId) throw new Error('capture_id is required');
  if (!['APPROVE', 'ADJUST', 'REJECT'].includes(decision)) {
    throw new Error('decision must be APPROVE, ADJUST, or REJECT');
  }

  const capture = findCaptureById_(captureId);
  if (!capture) throw new Error(`Capture not found: ${captureId}`);

  const queueSheet = getSheet_(STATIC_CONFIG.SHEETS.REVIEW_QUEUE);
  const data = queueSheet.getDataRange().getValues();
  const headers = data[0] || [];
  const idx = indexHeaders_(headers);
  let queueRow = -1;

  for (let rowIndex = data.length - 1; rowIndex >= 1; rowIndex--) {
    const sameCapture =
      idx.capture_id !== undefined &&
      String(data[rowIndex][idx.capture_id] || '') === captureId;
    const sameFile =
      idx.file_id !== undefined &&
      String(data[rowIndex][idx.file_id] || '') === String(capture.file_id);

    if (sameCapture || sameFile) {
      queueRow = rowIndex + 1;
      break;
    }
  }

  if (queueRow === -1) {
    queueRow = appendObject_(queueSheet, {
      result_id: '',
      request_id: capture.request_id || '',
      capture_id: captureId,
      file_id: capture.file_id,
      temp_filename: capture.original_filename || '',
      drive_url: capture.drive_url || '',
      scoring_status: 'COMPLETE',
      auto_decision: '',
      human_decision: decision,
      human_scope: String(payload.scope || ''),
      final_filename: '',
      next_action: 'HUMAN_REVIEW',
      processed_at: nowIso_(),
      human_notes: String(payload.notes || ''),
      approved_by: String(payload.approved_by || 'David'),
      decision_at: '',
    });
  } else {
    setCellByHeader_(queueSheet, queueRow, 'human_decision', decision);
    setCellByHeader_(queueSheet, queueRow, 'human_scope', String(payload.scope || ''));
    setCellByHeader_(queueSheet, queueRow, 'human_notes', String(payload.notes || ''));
    setCellByHeader_(queueSheet, queueRow, 'approved_by', String(payload.approved_by || 'David'));
    setCellByHeader_(queueSheet, queueRow, 'next_action', 'HUMAN_REVIEW');
  }

  const row = rowObject_(queueSheet, queueRow);
  const headerMap = headerMap_(queueSheet);
  const rowValues = queueSheet
    .getRange(queueRow, 1, 1, queueSheet.getLastColumn())
    .getValues()[0];

  applyHumanDecision_(
    queueSheet,
    queueRow,
    rowValues,
    headerMap,
    decision
  );

  return {
    ok: true,
    capture_id: captureId,
    decision,
    status:
      decision === 'APPROVE'
        ? 'APPROVED'
        : decision === 'ADJUST'
          ? 'ADJUSTMENT_REQUIRED'
          : 'REJECTED',
  };
}

function promoteAsset_(payload) {
  const captureId = String(
    payload.capture_id || ''
  ).trim();

  const anchorType = String(
    payload.anchor_type || ''
  ).trim();

  const allowedTypes = [
    'Identity Anchor',
    'Composition Anchor',
    'Mood Anchor',
    'Room Anchor',
    'Lighting Anchor',
    'Couple Relationship Anchor',
    'Detail Lock',
    'Publication Ready',
  ];

  if (!captureId) {
    throw new Error(
      'capture_id is required'
    );
  }

  if (
    !allowedTypes.includes(
      anchorType
    )
  ) {
    throw new Error(
      `Invalid anchor_type: ${anchorType}`
    );
  }

  const capture = findCaptureById_(
    captureId
  );

  if (!capture) {
    throw new Error(
      `Capture not found: ${captureId}`
    );
  }

  const file = DriveApp.getFileById(
    capture.file_id
  );

  appendObject_(
    getSheet_(
      STATIC_CONFIG.SHEETS
        .ASSET_REGISTRY
    ),
    {
      asset_id: newId_('AST'),
      created_at: nowIso_(),
      source_capture_id: captureId,
      source_file_id:
        capture.file_id,
      file_name: file.getName(),
      drive_url: file.getUrl(),
      project:
        capture.project || '',
      subjects:
        capture.identity_subjects || '',
      scope: anchorType,
      status: 'ACTIVE',
      approved_by: String(
        payload.approved_by ||
          'David'
      ),
      approval_notes: String(
        payload.notes || ''
      ),
      allowed_use:
        Array.isArray(
          payload.allowed_use
        )
          ? payload.allowed_use.join(
              ' | '
            )
          : String(
              payload.allowed_use || ''
            ),
      prohibited_use:
        Array.isArray(
          payload.prohibited_use
        )
          ? payload.prohibited_use.join(
              ' | '
            )
          : String(
              payload.prohibited_use || ''
            ),
    }
  );

  return {
    ok: true,
    capture_id: captureId,
    promoted_as: anchorType,
  };
}

function findCaptureById_(captureId) {
  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.CAPTURES
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    return null;
  }

  const headers = data[0];

  return (
    data
      .slice(1)
      .map(row =>
        Object.fromEntries(
          headers.map(
            (header, index) => [
              header,
              row[index],
            ]
          )
        )
      )
      .find(
        item =>
          String(
            item.capture_id
          ) === String(captureId)
      ) || null
  );
}

function assertSharedSecret_(e) {
  const expected =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        'VISUAL_OS_SHARED_SECRET'
      );

  if (!expected) {
    throw new Error(
      'VISUAL_OS_SHARED_SECRET is not configured'
    );
  }

  const received = String(
    e?.parameter?.secret || ''
  );

  if (received !== expected) {
    throw new Error('Unauthorized');
  }
}

function parseJsonBody_(e) {
  const raw = String(
    e?.postData?.contents || ''
  ).trim();

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(
      JSON.stringify(payload)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}

function countRows_(sheet) {
  if (!sheet) {
    return 0;
  }

  return Math.max(
    sheet.getLastRow() - 1,
    0
  );
}

function sanitizeVisibleName_(value) {
  return String(value || '')
    .replace(/_+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
