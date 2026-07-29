/**
 * VISUAL IDENTITY OS — SAFE DIAGNOSTICS
 *
 * Add this as a NEW Apps Script file.
 * It does not modify sheets, files, folders, sessions, captures, or requests.
 * It only reads Script Properties and validates sheet headers.
 */

function getActiveVisualSession_() {
  const props = PropertiesService.getScriptProperties();

  const sessionId = String(
    props.getProperty('ACTIVE_VISUAL_SESSION_ID') || ''
  ).trim();

  if (!sessionId) {
    return {
      ok: true,
      active: false,
      session: null,
    };
  }

  return {
    ok: true,
    active: true,
    session: {
      session_id: sessionId,
      project: String(props.getProperty('ACTIVE_VISUAL_SESSION_PROJECT') || ''),
      subjects: String(props.getProperty('ACTIVE_VISUAL_SESSION_SUBJECTS') || ''),
      scene: String(props.getProperty('ACTIVE_VISUAL_SESSION_SCENE') || ''),
      generator: String(props.getProperty('ACTIVE_VISUAL_SESSION_GENERATOR') || ''),
      started_at: String(props.getProperty('ACTIVE_VISUAL_SESSION_STARTED_AT') || ''),
      status: 'ACTIVE',
    },
  };
}

function validateVisualSchema_() {
  const required = {
    REQUESTS: [
      'request_id',
      'created_at',
      'project',
      'subjects',
      'scene',
      'prompt',
      'generator',
      'status',
      'expected_output_count',
      'source_folder_id',
      'notes',
      'mode',
      'mechanism',
      'pack_version',
      'parent_request_id',
      'source_result_id',
      'iteration',
    ],

    REVIEW_QUEUE: [
      'result_id',
      'request_id',
      'capture_id',
      'file_id',
      'temp_filename',
      'drive_url',
      'scoring_status',
      'auto_decision',
      'human_decision',
      'human_scope',
      'final_filename',
      'next_action',
      'processed_at',
      'human_notes',
      'approved_by',
      'decision_at',
    ],

    CAPTURES: [
      'capture_id',
      'file_id',
      'original_filename',
      'drive_url',
      'captured_at',
      'session_id',
      'request_id',
      'batch_id',
      'generator_inferred',
      'mime_type',
      'status',
      'selected_for_review',
      'identity_subjects',
      'project',
      'scene',
      'prompt_context',
      'duplicate_of',
      'technical_error',
      'notes',
    ],

    BATCHES: [
      'batch_id',
      'created_at',
      'session_id',
      'capture_count',
      'status',
      'score_call_count',
      'best_capture_id',
      'second_capture_id',
      'dominant_failure',
      'preserve',
      'next_adjustment',
      'review_summary',
      'human_status',
      'processed_at',
      'notes',
    ],

    RESULT_MEMORY: [
      'result_id',
      'request_id',
      'created_at',
      'project',
      'subjects',
      'scene',
      'mode',
      'mechanism',
      'pack_version',
      'model',
      'identity_fidelity',
      'composition',
      'anatomy',
      'skin_realism',
      'camera',
      'continuity',
      'mambo_accuracy',
      'rings_tattoos_accuracy',
      'ai_gloss',
      'overall_score',
      'auto_decision',
      'dominant_failure',
      'preserve',
      'next_adjustment',
      'permitted_use',
      'prohibited_use',
      'prompt',
      'asset_link',
    ],

    ASSET_REGISTRY: [
      'asset_id',
      'created_at',
      'source_capture_id',
      'source_file_id',
      'file_name',
      'drive_url',
      'project',
      'subjects',
      'scope',
      'status',
      'approved_by',
      'approval_notes',
      'allowed_use',
      'prohibited_use',
      'result_id',
      'final_filename',
      'scene',
      'overall_score',
      'approval_scope',
      'publication_status',
      'anchor_eligible',
      'human_anchor_approval',
      'approved_at',
    ],

    FAILURE_MEMORY: [
      'failure_id',
      'capture_id',
      'result_id',
      'request_id',
      'batch_id',
      'project',
      'subjects',
      'failure_category',
      'failure_description',
      'generator',
      'model',
      'prompt_version',
      'reference_pack',
      'repeated_failure',
      'do_not_reuse_as',
      'corrective_rule',
      'created_at',
      'notes',
    ],
  };

  const result = {};

  Object.keys(required).forEach(sheetKey => {
    const sheetName = STATIC_CONFIG.SHEETS[sheetKey];

    if (!sheetName) {
      result[sheetKey] = {
        sheet: '',
        ok: false,
        missing: [`STATIC_CONFIG.SHEETS.${sheetKey}`],
      };
      return;
    }

    const sheet = getSheet_(sheetName);
    const headers = Object.keys(headerMap_(sheet));
    const missing = required[sheetKey].filter(header => !headers.includes(header));

    result[sheetKey] = {
      sheet: sheetName,
      ok: missing.length === 0,
      missing,
    };
  });

  const allOk = Object.values(result).every(item => item.ok);

  return {
    ok: allOk,
    checked_at: nowIso_(),
    sheets: result,
  };
}
