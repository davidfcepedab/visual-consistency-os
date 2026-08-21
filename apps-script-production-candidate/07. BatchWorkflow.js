
/**
 * VISUAL IDENTITY OS — UNIVERSAL INBOX + BATCH REVIEW
 *
 * Add these sheet names to STATIC_CONFIG.SHEETS:
 * CAPTURES: 'CAPTURES'
 * BATCHES: 'BATCHES'
 * FAILURE_MEMORY: 'FAILURE_MEMORY'
 *
 * Existing INBOX folder ID remains unchanged. It was renamed to 00_Universal_Inbox.
 */

function captureUniversalInbox() {
  return withLock_(() => {
    const inbox = DriveApp.getFolderById(STATIC_CONFIG.FOLDERS.INBOX);
    const files = inbox.getFiles();
    const capturesSheet = getSheet_(STATIC_CONFIG.SHEETS.CAPTURES);
    let captured = 0;

    while (files.hasNext()) {
      const file = files.next();
      const mimeType = String(file.getMimeType() || '');

      if (!mimeType.startsWith('image/')) continue;
      if (captureExistsForFile_(file.getId())) continue;

      const inferred = inferCaptureContext_(file);
      appendObject_(capturesSheet, {
        capture_id: newId_('CAP'),
        file_id: file.getId(),
        original_filename: file.getName(),
        drive_url: file.getUrl(),
        captured_at: nowIso_(),
        session_id: inferred.session_id,
        request_id: inferred.request_id,
        batch_id: '',
        generator_inferred: inferred.generator,
        mime_type: mimeType,
        status: 'CAPTURED',
        selected_for_review: 'FALSE',
        identity_subjects: inferred.subjects,
        project: inferred.project,
        scene: inferred.scene,
        prompt_context: '',
        duplicate_of: '',
        technical_error: '',
        notes: inferred.notes,
      });
      captured++;
    }
    return captured;
  });
}

function buildPendingBatches() {
  return withLock_(() => {
    const cfg = getBatchRuntimeConfig_();
    const capturesSheet = getSheet_(STATIC_CONFIG.SHEETS.CAPTURES);
    const data = capturesSheet.getDataRange().getValues();
    if (data.length < 2) return 0;

    const headers = indexHeaders_(data[0]);
    const pending = [];

    for (let r = 1; r < data.length; r++) {
      const status = String(data[r][headers.status] || '').toUpperCase();
      if (status !== 'CAPTURED') continue;
      pending.push({row: r + 1, values: data[r]});
    }
    if (!pending.length) return 0;

    let created = 0;
    for (let i = 0; i < pending.length; i += cfg.batchMaxImages) {
      const group = pending.slice(i, i + cfg.batchMaxImages);
      const batchId = newId_('BAT');
      const sessionId = firstNonEmpty_(
        group.map(x => x.values[headers.session_id])
      );

      appendObject_(getSheet_(STATIC_CONFIG.SHEETS.BATCHES), {
        batch_id: batchId,
        created_at: nowIso_(),
        session_id: sessionId,
        capture_count: group.length,
        status: 'READY_TO_SCORE',
        score_call_count: 0,
        best_capture_id: '',
        second_capture_id: '',
        dominant_failure: '',
        preserve: '',
        next_adjustment: '',
        review_summary: '',
        human_status: 'PENDING',
        processed_at: '',
        notes: '',
      });

      group.forEach(item => {
        setCellByHeader_(capturesSheet, item.row, 'batch_id', batchId);
        setCellByHeader_(capturesSheet, item.row, 'status', 'BATCHED');
      });
      created++;
    }
    return created;
  });
}

function scorePendingBatches() {
  return withLock_(() => {
    const cfg = getBatchRuntimeConfig_();
    const batchesSheet = getSheet_(STATIC_CONFIG.SHEETS.BATCHES);
    const data = batchesSheet.getDataRange().getValues();
    if (data.length < 2) return 0;

    const headers = indexHeaders_(data[0]);
    let calls = 0;

    for (let r = 1; r < data.length; r++) {
      if (calls >= cfg.maxBatchCallsPerRun) break;

      const status = String(data[r][headers.status] || '').toUpperCase();
      if (status !== 'READY_TO_SCORE') continue;

      const batchId = String(data[r][headers.batch_id] || '');
      if (!batchId) continue;

      setCellByHeader_(batchesSheet, r + 1, 'status', 'SCORING');

      try {
        const captures = getCapturesForBatch_(batchId);
        if (!captures.length) throw new Error(`No captures found for ${batchId}`);

        const result = scoreBatchWithGemini_(batchId, captures);
        writeBatchScores_(batchId, captures, result, cfg);

        setCellByHeader_(batchesSheet, r + 1, 'status', 'REVIEW_READY');
        setCellByHeader_(batchesSheet, r + 1, 'score_call_count', 1);
        setCellByHeader_(batchesSheet, r + 1, 'best_capture_id', result.best_capture_id || '');
        setCellByHeader_(batchesSheet, r + 1, 'second_capture_id', result.second_capture_id || '');
        setCellByHeader_(batchesSheet, r + 1, 'dominant_failure', result.dominant_failure || '');
        setCellByHeader_(batchesSheet, r + 1, 'preserve', result.preserve || '');
        setCellByHeader_(batchesSheet, r + 1, 'next_adjustment', result.next_adjustment || '');
        setCellByHeader_(batchesSheet, r + 1, 'review_summary', result.review_summary || '');
        setCellByHeader_(batchesSheet, r + 1, 'processed_at', nowIso_());
      } catch (err) {
        setCellByHeader_(batchesSheet, r + 1, 'status', 'ERROR');
        setCellByHeader_(batchesSheet, r + 1, 'notes', String(err.message).slice(0, 500));
      }
      calls++;
    }
    return calls;
  });
}

function runUniversalInboxPipeline() {
  const captured = captureUniversalInbox();
  const batches = buildPendingBatches();
  const scored = scorePendingBatches();
  return {captured, batches, scored};
}

function scoreBatchWithGemini_(batchId, captures) {
  const runtime = getRuntimeConfig_();
  if (!runtime.geminiApiKey) {
    throw new Error('Missing GEMINI_API_KEY in Script Properties.');
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(runtime.geminiModel)}:generateContent?key=` +
    `${encodeURIComponent(runtime.geminiApiKey)}`;

  const parts = [{
    text: [
      'You are the Visual Identity OS batch reviewer.',
      'Evaluate every image individually. Do not merge identities.',
      'Return one result per capture_id and a batch summary.',
      'Use scores from 1.0 to 5.0.',
      'Do not promote anything to Identity Anchor.',
      'Rings and tattoos must be null when not visible or not verifiable.',
      'Mambo accuracy must be null when Mambo is absent.',
      '',
      `BATCH_ID: ${batchId}`,
      '',
      'DECISION GUIDANCE:',
      '- REVIEW: strong enough for human review.',
      '- DIAGNOSTIC: useful learning, not a candidate.',
      '- ARCHIVE: failed, duplicate, broken anatomy, or very weak.',
    ].join('\n')
  }];

  captures.forEach(c => {
    parts.push({
      text: [
        `CAPTURE_ID: ${c.capture_id}`,
        `FILENAME: ${c.original_filename}`,
        `SUBJECTS_HINT: ${c.identity_subjects || ''}`,
        `PROJECT_HINT: ${c.project || ''}`,
        `SCENE_HINT: ${c.scene || ''}`,
      ].join('\n')
    });
    const blob = DriveApp.getFileById(c.file_id).getBlob();
    parts.push({
      inlineData: {
        mimeType: c.mime_type || blob.getContentType(),
        data: Utilities.base64Encode(blob.getBytes())
      }
    });
  });

  const schema = {
    type: 'object',
    properties: {
      batch_id: {type: 'string'},
      best_capture_id: {type: 'string'},
      second_capture_id: {type: 'string'},
      dominant_failure: {type: 'string'},
      preserve: {type: 'string'},
      next_adjustment: {type: 'string'},
      review_summary: {type: 'string'},
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            capture_id: {type: 'string'},
            identity_fidelity: {type: 'number'},
            composition: {type: 'number'},
            anatomy: {type: 'number'},
            skin_realism: {type: 'number'},
            camera: {type: 'number'},
            continuity: {type: 'number'},
            mambo_accuracy: {type: ['number', 'null']},
            rings_tattoos_accuracy: {type: ['number', 'null']},
            ai_gloss: {type: 'number'},
            overall_score: {type: 'number'},
            decision: {type: 'string', enum: ['REVIEW','DIAGNOSTIC','ARCHIVE']},
            dominant_failure: {type: 'string'},
            preserve: {type: 'string'},
            next_adjustment: {type: 'string'},
            permitted_use: {type: 'array', items: {type: 'string'}},
            prohibited_use: {type: 'array', items: {type: 'string'}}
          },
          required: [
            'capture_id','identity_fidelity','composition','anatomy',
            'skin_realism','camera','continuity','mambo_accuracy',
            'rings_tattoos_accuracy','ai_gloss','overall_score',
            'decision','dominant_failure','preserve','next_adjustment',
            'permitted_use','prohibited_use'
          ]
        }
      }
    },
    required: [
      'batch_id','best_capture_id','second_capture_id',
      'dominant_failure','preserve','next_adjustment',
      'review_summary','results'
    ]
  };

  const payload = {
    contents: [{role: 'user', parts}],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: schema
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`Gemini batch ${code}: ${body}`);
  }

  const parsed = JSON.parse(body);
  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no structured batch content.');
  return JSON.parse(text);
}

function writeBatchScores_(batchId, captures, batchResult, cfg) {
  const capturesSheet = getSheet_(STATIC_CONFIG.SHEETS.CAPTURES);
  const reviewSheet = getSheet_(STATIC_CONFIG.SHEETS.REVIEW_QUEUE);
  const resultMap = {};

  (batchResult.results || []).forEach(result => {
    resultMap[String(result.capture_id)] = result;
  });

  captures.forEach(capture => {
    const score = resultMap[String(capture.capture_id)];
    if (!score) {
      const technicalErrorMessage = 'Gemini response did not include this capture_id';
      setCellByHeader_(
        capturesSheet,
        capture._sheetRow,
        'technical_error',
        technicalErrorMessage
      );
      registerTechnicalFailureFromBatch_(batchId, capture, technicalErrorMessage);
      return;
    }

    const file = DriveApp.getFileById(capture.file_id);
    const resultId = newId_('RES');
    const normalizedAutoDecision = computeBatchAutoDecision_(score, cfg);

    writeResultMemory_(
      resultId,
      {
        request_id: capture.request_id || '',
        project: capture.project || '',
        subjects: capture.identity_subjects || '',
        scene: capture.scene || '',
        mode: 'Batch Capture',
        mechanism: 'Universal Inbox',
        pack_version: '',
        prompt: capture.prompt_context || '',
      },
      file,
      {
        ...score,
        auto_decision: normalizedAutoDecision,
      }
    );

    if (normalizedAutoDecision === 'ADJUST') {
      const adjustedName = ensureFilenamePrefix_(file.getName(), 'ADJUST - ');
      file.setName(adjustedName);
      moveFile_(file, STATIC_CONFIG.FOLDERS.ADJUSTMENT);

      setCellByHeader_(capturesSheet, capture._sheetRow, 'status', 'ADJUSTMENT_REQUIRED');
      setCellByHeader_(capturesSheet, capture._sheetRow, 'selected_for_review', 'FALSE');
      // ADJUST is a normal, expected outcome — not a failure. FAILURE_MEMORY
      // is reserved for hard rejects and technical/blocking failures.
      return;
    }

    // APPROVE and REJECT are recommendations only.
    // Final approval/rejection requires a human decision, which triggers rename + move.
    const queueRow = appendObject_(reviewSheet, {
      result_id: resultId,
      request_id: capture.request_id || '',
      capture_id: capture.capture_id,
      file_id: capture.file_id,
      temp_filename: file.getName(),
      drive_url: file.getUrl(),
      scoring_status: 'COMPLETE',
      auto_decision: normalizedAutoDecision,
      human_decision: 'PENDING',
      human_scope: '',
      final_filename: '',
      next_action: 'HUMAN_REVIEW',
      processed_at: nowIso_(),
      human_notes: '',
      approved_by: '',
      decision_at: '',
    });

    moveFile_(file, STATIC_CONFIG.FOLDERS.HUMAN_REVIEW);
    setCellByHeader_(capturesSheet, capture._sheetRow, 'status', 'REVIEW_REQUIRED');
    setCellByHeader_(capturesSheet, capture._sheetRow, 'selected_for_review', 'TRUE');

    if (normalizedAutoDecision === 'REJECT') {
      registerFailureFromBatch_(batchId, capture, score);
    }
  });
}

// Pure decision function, exported for direct unit testing. Recommendation
// only — APPROVE and REJECT still require a human decision downstream.
// Documented scale: 1.0-2.9 Rejected, 3.0-3.9 Diagnostic. Hard rejection
// must never fire on a Diagnostic-band score (>= archiveThreshold).
function computeBatchAutoDecision_(score, cfg) {
  const identity = Number(score.identity_fidelity);
  const overall = Number(score.overall_score);
  const anatomy = Number(score.anatomy);
  const rejectThreshold = cfg.archiveThreshold;

  if (
    identity < rejectThreshold ||
    overall < rejectThreshold ||
    anatomy < rejectThreshold
  ) {
    return 'REJECT';
  }

  if (overall >= cfg.reviewThreshold && identity >= cfg.identityThreshold) {
    return 'APPROVE';
  }

  return 'ADJUST';
}

function ensureFilenamePrefix_(filename, prefix) {
  const clean = String(filename || '')
    .replace(/^(ADJUST|FAILED|APPROVED)\s*-\s*/i, '');
  return `${prefix}${clean}`;
}

// FAILURE_MEMORY is reserved for hard rejects and technical/blocking
// failures — never for ADJUST, which is a normal, expected outcome.
function registerTechnicalFailureFromBatch_(batchId, capture, message) {
  appendObject_(getSheet_(STATIC_CONFIG.SHEETS.FAILURE_MEMORY), {
    failure_id: newId_('FAIL'),
    capture_id: capture.capture_id,
    result_id: '',
    request_id: capture.request_id || '',
    batch_id: batchId,
    project: capture.project || '',
    subjects: capture.identity_subjects || '',
    failure_category: 'TECHNICAL',
    failure_description: message || '',
    generator: capture.generator_inferred || '',
    model: getRuntimeConfig_().geminiModel,
    prompt_version: '',
    reference_pack: '',
    repeated_failure: 'FALSE',
    do_not_reuse_as: '',
    corrective_rule: '',
    created_at: nowIso_(),
    notes: '',
  });
}

function registerFailureFromBatch_(batchId, capture, score) {
  appendObject_(getSheet_(STATIC_CONFIG.SHEETS.FAILURE_MEMORY), {
    failure_id: newId_('FAIL'),
    capture_id: capture.capture_id,
    result_id: '',
    request_id: capture.request_id || '',
    batch_id: batchId,
    project: capture.project || '',
    subjects: capture.identity_subjects || '',
    failure_category: inferFailureCategory_(score),
    failure_description: score.dominant_failure || '',
    generator: capture.generator_inferred || '',
    model: getRuntimeConfig_().geminiModel,
    prompt_version: '',
    reference_pack: '',
    repeated_failure: 'FALSE',
    do_not_reuse_as: (score.prohibited_use || []).join(' | '),
    corrective_rule: score.next_adjustment || '',
    created_at: nowIso_(),
    notes: '',
  });
}

function getCapturesForBatch_(batchId) {
  const sheet = getSheet_(STATIC_CONFIG.SHEETS.CAPTURES);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const idx = indexHeaders_(headers);
  const rows = [];

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idx.batch_id] || '') !== batchId) continue;
    const obj = Object.fromEntries(headers.map((h, i) => [h, data[r][i]]));
    obj._sheetRow = r + 1;
    rows.push(obj);
  }
  return rows;
}

function captureExistsForFile_(fileId) {
  const sheet = getSheet_(STATIC_CONFIG.SHEETS.CAPTURES);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;
  const idx = data[0].indexOf('file_id');
  if (idx === -1) return false;
  return data.slice(1).some(row => String(row[idx]) === String(fileId));
}

function inferCaptureContext_(file) {
  const name = String(file.getName() || '');
  const lower = name.toLowerCase();

  const reqMatch = name.match(/REQ-[A-Za-z0-9-]+/i);
  const sesMatch = name.match(/SES-[A-Za-z0-9-]+/i);

  let generator = 'UNKNOWN';
  if (lower.includes('chatgpt')) generator = 'CHATGPT';
  else if (lower.includes('gemini')) generator = 'GEMINI';
  else if (lower.includes('krea')) generator = 'KREA';
  else if (lower.includes('grok')) generator = 'GROK';

  const subjects = [];
  ['david','juan','mambo','couple','family'].forEach(x => {
    if (lower.includes(x)) subjects.push(x.charAt(0).toUpperCase() + x.slice(1));
  });

  const props = PropertiesService.getScriptProperties();
  const requestId = reqMatch ? reqMatch[0].toUpperCase() : '';
  const sessionId =
    sesMatch
      ? sesMatch[0].toUpperCase()
      : String(props.getProperty('ACTIVE_VISUAL_SESSION_ID') || '');

  let request = {};
  if (requestId && typeof findRequestById_ === 'function') {
    request = findRequestById_(requestId) || {};
  }

  return {
    request_id: requestId,
    session_id: sessionId,
    generator:
      generator !== 'UNKNOWN'
        ? generator
        : String(props.getProperty('ACTIVE_VISUAL_SESSION_GENERATOR') || 'UNKNOWN'),
    subjects:
      subjects.join(' + ') ||
      String(request.subjects || '') ||
      String(props.getProperty('ACTIVE_VISUAL_SESSION_SUBJECTS') || ''),
    project:
      String(request.project || '') ||
      String(props.getProperty('ACTIVE_VISUAL_SESSION_PROJECT') || ''),
    scene:
      String(request.scene || '') ||
      String(props.getProperty('ACTIVE_VISUAL_SESSION_SCENE') || ''),
    notes:
      requestId || sessionId
        ? ''
        : 'Captured without formal request/session ID',
  };
}

function getBatchRuntimeConfig_() {
  return {
    batchMaxImages: Number(getConfigValue_('BATCH_MAX_IMAGES', 4)),
    batchIdleMinutes: Number(getConfigValue_('BATCH_IDLE_MINUTES', 20)),
    maxBatchCallsPerRun: Number(getConfigValue_('MAX_BATCH_CALLS_PER_RUN', 3)),
    reviewThreshold: Number(getConfigValue_('BATCH_REVIEW_THRESHOLD', 4.4)),
    identityThreshold: Number(getConfigValue_('BATCH_IDENTITY_THRESHOLD', 4.3)),
    archiveThreshold: Number(getConfigValue_('BATCH_ARCHIVE_THRESHOLD', 3.5)),
  };
}

function getConfigValue_(key, fallback) {
  const sheet = getSheet_(STATIC_CONFIG.SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() === key) return data[r][1];
  }
  return fallback;
}

function indexHeaders_(headers) {
  const idx = {};
  headers.forEach((h, i) => idx[String(h).trim()] = i);
  return idx;
}

function firstNonEmpty_(values) {
  for (const value of values) {
    if (String(value || '').trim()) return String(value);
  }
  return '';
}

function inferFailureCategory_(score) {
  const failure = String(score.dominant_failure || '').toLowerCase();
  if (failure.includes('identity') || failure.includes('face')) return 'IDENTITY';
  if (failure.includes('anatom')) return 'ANATOMY';
  if (failure.includes('skin') || failure.includes('gloss')) return 'REALISM';
  if (failure.includes('tattoo') || failure.includes('ring')) return 'DETAIL_LOCK';
  if (failure.includes('camera') || failure.includes('perspective')) return 'CAMERA';
  return 'OTHER';
}
