const SCORE_SCHEMA = {
  type: 'object',
  required: [
    'identity_fidelity','composition','anatomy','skin_realism','camera',
    'continuity','mambo_accuracy','rings_tattoos_accuracy','ai_gloss',
    'overall_score','auto_decision','dominant_failure','preserve',
    'next_adjustment','permitted_use','prohibited_use'
  ],
  properties: {
    identity_fidelity: {type: 'number', minimum: 0, maximum: 5},
    composition: {type: 'number', minimum: 0, maximum: 5},
    anatomy: {type: 'number', minimum: 0, maximum: 5},
    skin_realism: {type: 'number', minimum: 0, maximum: 5},
    camera: {type: 'number', minimum: 0, maximum: 5},
    continuity: {type: 'number', minimum: 0, maximum: 5},
    mambo_accuracy: {type: ['number','null'], minimum: 0, maximum: 5},
    rings_tattoos_accuracy: {type: ['number','null'], minimum: 0, maximum: 5},
    ai_gloss: {type: 'number', minimum: 0, maximum: 5},
    overall_score: {type: 'number', minimum: 0, maximum: 5},
    auto_decision: {type: 'string', enum: ['APPROVE','ADJUST','REJECT']},
    dominant_failure: {type: 'string'},
    preserve: {type: 'string'},
    next_adjustment: {type: 'string'},
    permitted_use: {type: 'array', items: {type: 'string'}},
    prohibited_use: {type: 'array', items: {type: 'string'}}
  }
};

function buildScoringPrompt_(request, filename) {
  return `
You are the scoring engine for Visual Identity OS.

Evaluate ONE generated image. Do not flatter. Identity fidelity has priority over beauty.

Expected request:
- Project: ${escapeJsonText_(request.project)}
- Subjects: ${escapeJsonText_(request.subjects)}
- Scene: ${escapeJsonText_(request.scene)}
- Original prompt: ${escapeJsonText_(request.prompt)}
- Filename: ${escapeJsonText_(filename)}

Scoring:
5.0 Approved Hero
4.8-4.9 Approved Candidate
4.5-4.7 Composition / Mood Candidate
4.0-4.4 Useful Test
3.0-3.9 Diagnostic
1.0-2.9 Rejected

Critical rules:
- identity_fidelity below 4.0 is a failure.
- no automatic Identity Anchor authorization.
- tattoos and rings may only score when clearly visible and verified; otherwise return null.
- Mambo accuracy may be null when Mambo is absent.
- APPROVE means operational candidate requiring human approval, never automatic anchor promotion.
- ADJUST means preserve the strongest elements and state only one priority correction.
- REJECT means wrong identity, severe anatomy, face blending, generic subject, severe Mambo drift, or unusable image.
- ai_gloss: 0 is fully photographic, 5 is strongly artificial.
- Return JSON only.
`.trim();
}

function scoreImageWithGemini_(file, request) {
  const cfg = getRuntimeConfig_();
  if (!cfg.geminiApiKey) throw new Error('Missing GEMINI_API_KEY in Script Properties.');

  const blob = file.getBlob();
  const b64 = Utilities.base64Encode(blob.getBytes());
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent?key=${encodeURIComponent(cfg.geminiApiKey)}`;

  const payload = {
    contents: [{
      role: 'user',
      parts: [
        {text: buildScoringPrompt_(request, file.getName())},
        {inlineData: {mimeType: blob.getContentType(), data: b64}}
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: SCORE_SCHEMA
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`Gemini ${code}: ${body.slice(0, 1000)}`);
  }

  const parsed = JSON.parse(body);
  const text = parsed?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error(`Gemini response missing JSON text: ${body.slice(0, 1000)}`);

  const score = JSON.parse(text);
  return normalizeDecision_(score);
}

// Pure decision function, exported for direct unit testing. Hard rejection
// is a recommendation only — final APPROVE/REJECT stays human-controlled
// downstream (see applyHumanDecision_ in 06. Workflow.js).
function computeAutoDecision_(score) {
  const id = Number(score.identity_fidelity);
  const overall = Number(score.overall_score);
  const anatomy = Number(score.anatomy);
  const rejectThreshold = STATIC_CONFIG.DEFAULTS.AUTO_REJECT_THRESHOLD;

  // Documented scale: 1.0-2.9 Rejected, 3.0-3.9 Diagnostic. Hard rejection
  // must never fire on a Diagnostic-band score (>= 3.0).
  if (id < rejectThreshold || overall < rejectThreshold || anatomy < rejectThreshold) {
    return 'REJECT';
  }

  if (
    id >= STATIC_CONFIG.DEFAULTS.AUTO_APPROVE_MIN_IDENTITY &&
    overall >= STATIC_CONFIG.DEFAULTS.AUTO_APPROVE_MIN_OVERALL &&
    anatomy >= 4.2
  ) {
    return 'APPROVE';
  }

  return 'ADJUST';
}

function normalizeDecision_(score) {
  score.auto_decision = computeAutoDecision_(score);
  return score;
}