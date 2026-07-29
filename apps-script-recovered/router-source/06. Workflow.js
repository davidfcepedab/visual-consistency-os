function processInbox() {
  throw new Error(
    'Legacy processInbox is disabled. Use runUniversalInboxPipeline instead.'
  );
}

function processOneInboxFile_(file) {
  moveFile_(file, STATIC_CONFIG.FOLDERS.TO_SCORE);

  const request = findRequestForFile_(file);
  const resultId = newId_('RES');
  const queueSheet = getSheet_(STATIC_CONFIG.SHEETS.REVIEW_QUEUE);

  const queueRow = appendObject_(queueSheet, {
    result_id: resultId,
    request_id: request.request_id || '',
    file_id: file.getId(),
    temp_filename: file.getName(),
    drive_url: file.getUrl(),
    scoring_status: 'RUNNING',
    auto_decision: '',
    human_decision: 'PENDING',
    human_scope: '',
    final_filename: '',
    next_action: 'SCORE',
    processed_at: nowIso_(),
    human_notes: '',
    approved_by: '',
    decision_at: '',
  });

  try {
    const score = scoreImageWithGemini_(file, request);

    writeResultMemory_(
      resultId,
      request,
      file,
      score
    );

    setCellByHeader_(
      queueSheet,
      queueRow,
      'scoring_status',
      'COMPLETE'
    );

    setCellByHeader_(
      queueSheet,
      queueRow,
      'auto_decision',
      score.auto_decision
    );

    setCellByHeader_(
      queueSheet,
      queueRow,
      'next_action',
      'HUMAN_REVIEW'
    );

    moveFile_(
      file,
      STATIC_CONFIG.FOLDERS.HUMAN_REVIEW
    );

  } catch (err) {
    setCellByHeader_(
      queueSheet,
      queueRow,
      'scoring_status',
      'ERROR'
    );

    setCellByHeader_(
      queueSheet,
      queueRow,
      'next_action',
      String(err.message).slice(0, 500)
    );

    throw err;
  }
}

function findRequestForFile_(file) {
  const sheet = getSheet_(STATIC_CONFIG.SHEETS.REQUESTS);
  const data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return {};
  }

  const headers = data[0];
  const idx = {};

  headers.forEach((header, index) => {
    idx[String(header).trim()] = index;
  });

  const fileName = file.getName().toLowerCase();

  for (let rowIndex = data.length - 1; rowIndex >= 1; rowIndex--) {
    const requestId = String(
      data[rowIndex][idx.request_id] || ''
    );

    if (
      requestId &&
      fileName.includes(requestId.toLowerCase())
    ) {
      return Object.fromEntries(
        headers.map((header, columnIndex) => [
          header,
          data[rowIndex][columnIndex],
        ])
      );
    }
  }

  // Fallback: use the most recent open request.
  for (let rowIndex = data.length - 1; rowIndex >= 1; rowIndex--) {
    const status = String(
      data[rowIndex][idx.status] || ''
    ).toUpperCase();

    if (
      ['REQUESTED', 'GENERATED', 'OPEN', ''].includes(status)
    ) {
      return Object.fromEntries(
        headers.map((header, columnIndex) => [
          header,
          data[rowIndex][columnIndex],
        ])
      );
    }
  }

  return {};
}

function writeResultMemory_(
  resultId,
  request,
  file,
  score
) {
  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.RESULT_MEMORY
  );

  appendObject_(sheet, {
    result_id: resultId,
    request_id: request.request_id || '',
    created_at: nowIso_(),
    project: request.project || '',
    subjects: request.subjects || '',
    scene: request.scene || '',
    mode: request.mode || 'Lock',
    mechanism: request.mechanism || 'Pack/LoRA',
    pack_version: request.pack_version || '',
    model: getRuntimeConfig_().geminiModel,

    identity_fidelity: score.identity_fidelity,
    composition: score.composition,
    anatomy: score.anatomy,
    skin_realism: score.skin_realism,
    camera: score.camera,
    continuity: score.continuity,

    mambo_accuracy:
      score.mambo_accuracy === null
        ? ''
        : score.mambo_accuracy,

    rings_tattoos_accuracy:
      score.rings_tattoos_accuracy === null
        ? ''
        : score.rings_tattoos_accuracy,

    ai_gloss: score.ai_gloss,
    overall_score: score.overall_score,
    auto_decision: score.auto_decision,

    dominant_failure: score.dominant_failure,
    preserve: score.preserve,
    next_adjustment: score.next_adjustment,

    permitted_use: (
      score.permitted_use || []
    ).join(' | '),

    prohibited_use: (
      score.prohibited_use || []
    ).join(' | '),

    prompt: request.prompt || '',
    asset_link: file.getUrl(),
  });
}

function processHumanDecisions() {
  return withLock_(() => {
    const sheet = getSheet_(
      STATIC_CONFIG.SHEETS.REVIEW_QUEUE
    );

    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return 0;
    }

    const headers = headerMap_(sheet);

    const values = sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        sheet.getLastColumn()
      )
      .getValues();

    let count = 0;

    values.forEach((row, offset) => {
      const sheetRow = offset + 2;

      const decision = String(
        row[headers.human_decision - 1] || ''
      ).toUpperCase();

      const nextAction = String(
        row[headers.next_action - 1] || ''
      ).toUpperCase();

      if (
        !['APPROVE', 'ADJUST', 'REJECT'].includes(decision)
      ) {
        return;
      }

      if (nextAction !== 'HUMAN_REVIEW') {
        return;
      }

      applyHumanDecision_(
        sheet,
        sheetRow,
        row,
        headers,
        decision
      );

      count++;
    });

    return count;
  });
}

function applyHumanDecision_(
  sheet,
  sheetRow,
  row,
  headers,
  decision
) {
  const fileId = String(
    row[headers.file_id - 1] || ''
  );

  const resultId = String(
    row[headers.result_id - 1] || ''
  );

  const requestId = String(
    row[headers.request_id - 1] || ''
  );

  const scope = String(
    row[headers.human_scope - 1] || ''
  );

  const humanNotes = headers.human_notes
  ? String(
      row[headers.human_notes - 1] || ''
    )
  : '';

const manuallyEnteredReviewer = headers.approved_by
  ? String(
      row[headers.approved_by - 1] || ''
    )
  : '';

const approvedBy =
  manuallyEnteredReviewer ||
  'David';

  if (!fileId) {
    throw new Error(
      `Missing file_id for row ${sheetRow}`
    );
  }

  const file = DriveApp.getFileById(fileId);

  if (decision === 'APPROVE') {
    const finalName = buildFinalFilename_(
      resultId,
      requestId,
      file
    );

    file.setName(finalName);

    moveFile_(
      file,
      STATIC_CONFIG.FOLDERS.APPROVED
    );

    setCellByHeader_(
      sheet,
      sheetRow,
      'final_filename',
      finalName
    );

    setCellByHeader_(
      sheet,
      sheetRow,
      'next_action',
      'COMPLETED_APPROVED'
    );

    appendAssetRegistry_(
      resultId,
      finalName,
      file,
      scope,
      approvedBy,
      humanNotes
    );

  } else if (decision === 'ADJUST') {
    const currentName = file
      .getName()
      .replace(/^ADJUST - /, '');

    const finalName = `ADJUST - ${currentName}`;

    file.setName(finalName);

    moveFile_(
      file,
      STATIC_CONFIG.FOLDERS.ADJUSTMENT
    );

    setCellByHeader_(
      sheet,
      sheetRow,
      'final_filename',
      finalName
    );

    setCellByHeader_(
      sheet,
      sheetRow,
      'next_action',
      'CREATE_CORRECTION_REQUEST'
    );

    createCorrectionRequest_(
      resultId,
      requestId
    );

  } else if (decision === 'REJECT') {
    const currentName = file
      .getName()
      .replace(/^FAILED - /, '');

    const finalName = `FAILED - ${currentName}`;

    file.setName(finalName);

    moveFile_(
      file,
      STATIC_CONFIG.FOLDERS.REJECTED
    );

    setCellByHeader_(
      sheet,
      sheetRow,
      'final_filename',
      finalName
    );

    setCellByHeader_(
      sheet,
      sheetRow,
      'next_action',
      'COMPLETED_REJECTED'
    );
  }

  setCellByHeader_(
    sheet,
    sheetRow,
    'approved_by',
    approvedBy
  );

  setCellByHeader_(
    sheet,
    sheetRow,
    'decision_at',
    nowIso_()
  );

  setCellByHeader_(
    sheet,
    sheetRow,
    'processed_at',
    nowIso_()
  );

  syncCaptureDecisionStatus_(fileId, decision);
}

function syncCaptureDecisionStatus_(fileId, decision) {
  const captureSheet = getSheet_(STATIC_CONFIG.SHEETS.CAPTURES);
  const data = captureSheet.getDataRange().getValues();
  if (data.length < 2) return;

  const idx = indexHeaders_(data[0]);
  if (idx.file_id === undefined || idx.status === undefined) return;

  const statusMap = {
    APPROVE: 'APPROVED',
    ADJUST: 'ADJUSTMENT_REQUIRED',
    REJECT: 'REJECTED',
  };

  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    if (String(data[rowIndex][idx.file_id] || '') !== String(fileId)) continue;
    setCellByHeader_(captureSheet, rowIndex + 1, 'status', statusMap[decision] || decision);
    setCellByHeader_(
      captureSheet,
      rowIndex + 1,
      'selected_for_review',
      'FALSE'
    );
    break;
  }
}

function buildFinalFilename_(
  resultId,
  requestId,
  file
) {
  const request = findRequestById_(requestId);

  const project = sanitizeToken_(
    request.project,
    'Daily'
  );

  const subjects = sanitizeToken_(
    request.subjects,
    'Subject'
  );

  const scene = sanitizeToken_(
    request.scene,
    'Scene'
  );

  const extensionMatch = file
    .getName()
    .match(/(\.[A-Za-z0-9]+)$/);

  const extension = extensionMatch
    ? extensionMatch[1].toLowerCase()
    : '.png';

  const version = nextVersion_(
    project,
    subjects,
    scene
  );

  return (
    `${project} - ${subjects} - ${scene}` +
    ` - v${String(version).padStart(2, '0')}` +
    `${extension}`
  );
}

function nextVersion_(
  project,
  subjects,
  scene
) {
  const folder = DriveApp.getFolderById(
    STATIC_CONFIG.FOLDERS.APPROVED
  );

  const prefix =
    `${project} - ${subjects} - ${scene} - v`;

  const files = folder.getFiles();
  let maxVersion = 0;

  while (files.hasNext()) {
    const name = files.next().getName();

    if (!name.startsWith(prefix)) {
      continue;
    }

    const match = name.match(/ - v(\d{2,})/);

    if (match) {
      maxVersion = Math.max(
        maxVersion,
        Number(match[1])
      );
    }
  }

  return maxVersion + 1;
}

function findRequestById_(requestId) {
  if (!requestId) {
    return {};
  }

  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.REQUESTS
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    return {};
  }

  const headers = data[0];
  const requestIdIndex =
    headers.indexOf('request_id');

  if (requestIdIndex === -1) {
    throw new Error(
      'Missing request_id column in REQUESTS'
    );
  }

  for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
    if (
      String(
        data[rowIndex][requestIdIndex]
      ) === requestId
    ) {
      return Object.fromEntries(
        headers.map((header, columnIndex) => [
          header,
          data[rowIndex][columnIndex],
        ])
      );
    }
  }

  return {};
}

function appendAssetRegistry_(
  resultId,
  finalName,
  file,
  scope,
  approvedBy,
  approvalNotes
) {
  const memory = findResultMemory_(resultId);

  appendObject_(
    getSheet_(
      STATIC_CONFIG.SHEETS.ASSET_REGISTRY
    ),
    {
      asset_id: newId_('AST'),
      result_id: resultId,
      final_filename: finalName,
      project: memory.project || '',
      subjects: memory.subjects || '',
      scene: memory.scene || '',
      overall_score: memory.overall_score || '',

      approval_scope:
        scope || 'Approved Candidate',

      publication_status: 'CANDIDATE',
      anchor_eligible: 'FALSE',
      human_anchor_approval: 'PENDING',

      drive_url: file.getUrl(),
      approved_at: nowIso_(),
      approved_by: approvedBy || '',
      approval_notes: approvalNotes || '',
    }
  );
}

function findResultMemory_(resultId) {
  const sheet = getSheet_(
    STATIC_CONFIG.SHEETS.RESULT_MEMORY
  );

  const data = sheet
    .getDataRange()
    .getValues();

  if (data.length < 2) {
    return {};
  }

  const headers = data[0];
  const resultIdIndex =
    headers.indexOf('result_id');

  if (resultIdIndex === -1) {
    throw new Error(
      'Missing result_id column in RESULT_MEMORY'
    );
  }

  for (
    let rowIndex = data.length - 1;
    rowIndex >= 1;
    rowIndex--
  ) {
    if (
      String(
        data[rowIndex][resultIdIndex]
      ) === resultId
    ) {
      return Object.fromEntries(
        headers.map((header, columnIndex) => [
          header,
          data[rowIndex][columnIndex],
        ])
      );
    }
  }

  return {};
}

function createCorrectionRequest_(
  resultId,
  originalRequestId
) {
  const memory = findResultMemory_(resultId);
  const original =
    findRequestById_(originalRequestId);

  appendObject_(
    getSheet_(STATIC_CONFIG.SHEETS.REQUESTS),
    {
      request_id: newId_('REQ'),
      created_at: nowIso_(),

      project:
        original.project ||
        memory.project ||
        '',

      subjects:
        original.subjects ||
        memory.subjects ||
        '',

      scene:
        original.scene ||
        memory.scene ||
        '',

      prompt: [
        original.prompt ||
          memory.prompt ||
          '',
        '',
        'CORRECTION PASS:',
        `Preserve: ${memory.preserve || ''}`,
        `Change only: ${memory.next_adjustment || ''}`,
        'Do not redesign the scene.',
        'Generate exactly one image.',
      ].join('\n'),

      generator:
        original.generator || '',

      status: 'ADJUSTMENT_REQUESTED',
      expected_output_count: 1,

      source_folder_id:
        STATIC_CONFIG.FOLDERS.ADJUSTMENT,

      notes:
        `Derived from ${resultId}`,
    }
  );
}