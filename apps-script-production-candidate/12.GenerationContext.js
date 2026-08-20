/**
 * VISUAL IDENTITY OS — GENERATION CONTEXT READ
 *
 * Returns a revisioned snapshot of CONFIG, registries, captures, requests,
 * and result memory so the MCP can prepare a host-native generation packet.
 * This file contains no write, move, scoring, promotion, or render operations.
 */

function getGenerationContextSafe_() {
  try {
    const configRecords = readSheetRecordsSafe_(
      STATIC_CONFIG.SHEETS.CONFIG
    );
    const snapshot = {
      config: configMapFromRecordsSafe_(configRecords),
      asset_registry: readSheetRecordsSafe_(
        STATIC_CONFIG.SHEETS.ASSET_REGISTRY
      ),
      asset_index: readExternalSheetRecordsSafe_(
        STATIC_CONFIG.PROMPT_GENERATOR_SPREADSHEET_ID,
        STATIC_CONFIG.SHEETS.ASSET_INDEX
      ),
      captures: readSheetRecordsSafe_(
        STATIC_CONFIG.SHEETS.CAPTURES
      ),
      requests: readSheetRecordsSafe_(
        STATIC_CONFIG.SHEETS.REQUESTS
      ),
      result_memory: readSheetRecordsSafe_(
        STATIC_CONFIG.SHEETS.RESULT_MEMORY
      ),
    };
    snapshot.revision = revisionForSafeRead_(snapshot)
      .replace('sheet-', 'generation-');

    return {
      ok: true,
      snapshot,
    };
  } catch (_error) {
    return safeReadError_(
      'BACKEND_ERROR',
      'Visual generation context failed',
      true
    );
  }
}

function configMapFromRecordsSafe_(records) {
  const out = {};
  (records || []).forEach(record => {
    const keys = Object.keys(record || {});
    const key = String(
      record.key ||
      record.KEY ||
      record.config_key ||
      (keys[0] ? record[keys[0]] : '') ||
      ''
    ).trim();
    let value = record.value;
    if (value === undefined || value === null) {
      if (record.VALUE !== undefined) value = record.VALUE;
      else if (record.config_value !== undefined) {
        value = record.config_value;
      } else if (keys.length > 1) {
        value = record[keys[1]];
      }
    }
    if (key) out[key] = value;
  });
  return out;
}
