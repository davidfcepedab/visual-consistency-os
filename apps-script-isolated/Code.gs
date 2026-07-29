/**
 * Isolated implementation of the three safe-read actions required by the MCP.
 *
 * This project is fixture-only by design. It does not connect to a spreadsheet,
 * does not perform writes, and must not replace the production doGet router.
 */

var VISUAL_OS_ISOLATED_READ_ACTIONS_ = Object.freeze([
  "capture",
  "orphan_snapshot",
  "batches_catalog",
]);

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    if (!isAuthorizedIsolatedRequest_(params.secret)) {
      return jsonOutput_(
        errorResponse_("UNAUTHORIZED", "Unauthorized request", false)
      );
    }

    return jsonOutput_(
      handleVisualReadAction_(
        String(params.action || ""),
        params,
        getVisualReadStore_()
      )
    );
  } catch (_error) {
    return jsonOutput_(
      errorResponse_("INTERNAL_ERROR", "Isolated read request failed", false)
    );
  }
}

function doPost(_e) {
  return jsonOutput_(
    errorResponse_(
      "METHOD_NOT_ALLOWED",
      "This isolated project is read-only",
      false
    )
  );
}

function handleVisualReadAction_(action, params, store) {
  var safeParams = params || {};
  var safeStore = store || getVisualReadStore_();

  if (VISUAL_OS_ISOLATED_READ_ACTIONS_.indexOf(action) === -1) {
    return errorResponse_(
      "INVALID_ARGUMENT",
      "Unsupported read action",
      false
    );
  }

  if (action === "capture") {
    return getCaptureByExactId_(String(safeParams.id || ""), safeStore);
  }
  if (action === "orphan_snapshot") {
    return getOrphanSnapshot_(safeStore);
  }
  return getBatchesCatalog_(safeStore);
}

function getCaptureByExactId_(captureId, store) {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(captureId)) {
    return errorResponse_(
      "INVALID_ARGUMENT",
      "capture_id is invalid",
      false
    );
  }

  var captures = arrayField_(store, "captures");
  for (var index = 0; index < captures.length; index += 1) {
    if (String(captures[index].capture_id || "") === captureId) {
      return {
        ok: true,
        capture: cloneJson_(captures[index]),
      };
    }
  }

  return errorResponse_("NOT_FOUND", "Capture was not found", false);
}

function getOrphanSnapshot_(store) {
  var snapshot = {
    captures: cloneJson_(arrayField_(store, "captures")),
    batches: cloneJson_(arrayField_(store, "batches")),
    requests: cloneJson_(arrayField_(store, "requests")),
    reviews: cloneJson_(arrayField_(store, "reviews")),
    result_memory: cloneJson_(arrayField_(store, "result_memory")),
    assets: cloneJson_(arrayField_(store, "assets")),
  };
  snapshot.revision = revisionForPayload_(snapshot);

  return {
    ok: true,
    snapshot: snapshot,
  };
}

function getBatchesCatalog_(store) {
  var batches = cloneJson_(arrayField_(store, "batches"));
  return {
    ok: true,
    revision: revisionForPayload_({ batches: batches }),
    batches: batches,
  };
}

function getVisualReadStore_() {
  // This hard-coded fixture provider prevents accidental production reads.
  return getSyntheticVisualStore_();
}

function isAuthorizedIsolatedRequest_(providedSecret) {
  var configuredSecret = PropertiesService.getScriptProperties().getProperty(
    "VISUAL_OS_SHARED_SECRET"
  );
  return Boolean(
    configuredSecret && providedSecret && providedSecret === configuredSecret
  );
}

function arrayField_(store, field) {
  return store && Array.isArray(store[field]) ? store[field] : [];
}

function cloneJson_(value) {
  return JSON.parse(JSON.stringify(value));
}

function revisionForPayload_(payload) {
  var serialized = JSON.stringify(payload);
  var hash = 2166136261;
  for (var index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "fixture-" + ("00000000" + hash.toString(16)).slice(-8);
}

function errorResponse_(code, message, retryable) {
  return {
    ok: false,
    error: {
      code: code,
      message: message,
      retryable: Boolean(retryable),
    },
  };
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
