/**
 * VISUAL IDENTITY OS — UNIFIED AUTOMATION SETUP
 *
 * The universal batch pipeline is the only Inbox reader.
 * Human decisions are processed separately and perform final rename + move.
 */
function setupAutomation() {
  const props = PropertiesService.getScriptProperties();

  const defaults = {
    POLL_MINUTES: STATIC_CONFIG.DEFAULTS.POLL_MINUTES,
    BATCH_MAX_IMAGES: STATIC_CONFIG.DEFAULTS.BATCH_MAX_IMAGES,
    BATCH_IDLE_MINUTES: STATIC_CONFIG.DEFAULTS.BATCH_IDLE_MINUTES,
    MAX_BATCH_CALLS_PER_RUN: STATIC_CONFIG.DEFAULTS.MAX_BATCH_CALLS_PER_RUN,
    BATCH_REVIEW_THRESHOLD: STATIC_CONFIG.DEFAULTS.BATCH_REVIEW_THRESHOLD,
    BATCH_IDENTITY_THRESHOLD: STATIC_CONFIG.DEFAULTS.BATCH_IDENTITY_THRESHOLD,
    BATCH_ARCHIVE_THRESHOLD: STATIC_CONFIG.DEFAULTS.BATCH_ARCHIVE_THRESHOLD,
    GEMINI_MODEL: STATIC_CONFIG.DEFAULTS.GEMINI_MODEL,
  };

  Object.entries(defaults).forEach(([key, value]) => {
    if (!props.getProperty(key)) props.setProperty(key, String(value));
  });

  const managedHandlers = [
    'processInbox',
    'captureUniversalInbox',
    'buildPendingBatches',
    'scorePendingBatches',
    'runUniversalInboxPipeline',
    'processHumanDecisions',
  ];

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (managedHandlers.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('runUniversalInboxPipeline')
    .timeBased()
    .everyMinutes(getRuntimeConfig_().pollMinutes)
    .create();

  ScriptApp.newTrigger('processHumanDecisions')
    .timeBased()
    .everyMinutes(getRuntimeConfig_().pollMinutes)
    .create();

  return {
    status: 'READY',
    pipeline: 'UNIVERSAL_BATCH_ONLY',
    triggers: ['runUniversalInboxPipeline', 'processHumanDecisions'],
    spreadsheet: `https://docs.google.com/spreadsheets/d/${STATIC_CONFIG.SPREADSHEET_ID}/edit`,
    inbox: `https://drive.google.com/drive/folders/${STATIC_CONFIG.FOLDERS.INBOX}`,
    gemini_model: getRuntimeConfig_().geminiModel,
    gemini_api_key_configured: Boolean(getRuntimeConfig_().geminiApiKey),
  };
}

function setGeminiApiKey(apiKey) {
  const clean = String(apiKey || '').trim();
  if (clean.length < 20) throw new Error('Invalid API key.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', clean);
  return {ok: true, configured: true};
}

function testGeminiConnection() {
  const cfg = getRuntimeConfig_();
  if (!cfg.geminiApiKey) {
    throw new Error('Missing GEMINI_API_KEY in Script Properties.');
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(cfg.geminiModel)}:generateContent?key=` +
    `${encodeURIComponent(cfg.geminiApiKey)}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{role: 'user', parts: [{text: 'Return only: OK'}]}],
      generationConfig: {maxOutputTokens: 10},
    }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(`Gemini connection ${code}: ${body.slice(0, 1000)}`);
  }

  return {
    ok: true,
    model: cfg.geminiModel,
    response_code: code,
  };
}

function testHealthCheck() {
  const result = healthCheck();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function healthCheck() {
  const checks = {
    spreadsheet: false,
    folders: {},
    geminiApiKeyConfigured: Boolean(getRuntimeConfig_().geminiApiKey),
    geminiModel: getRuntimeConfig_().geminiModel,
    triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()),
  };

  SpreadsheetApp.openById(STATIC_CONFIG.SPREADSHEET_ID).getName();
  checks.spreadsheet = true;

  Object.entries(STATIC_CONFIG.FOLDERS).forEach(([key, id]) => {
    checks.folders[key] = DriveApp.getFolderById(id).getName();
  });

  return checks;
}
