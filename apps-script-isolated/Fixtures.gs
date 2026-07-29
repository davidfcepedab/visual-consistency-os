/**
 * Synthetic-only data for the isolated Visual OS Apps Script contract.
 *
 * None of these identifiers, records, or values originate from production.
 * This file intentionally performs no SpreadsheetApp, DriveApp, or UrlFetchApp
 * calls.
 */
function getSyntheticVisualStore_() {
  return {
    captures: [
      {
        capture_id: "CAP-001",
        filename: "image-001.png",
        batch_id: "BATCH-001",
        request_id: "REQ-001",
        session_id: "SESSION-001",
        project: "SYNTHETIC-WEDDING",
        created_at: "2026-01-01T10:00:00.000Z",
      },
      {
        capture_id: "CAP-UNKNOWN-LINEAGE",
        filename: "unknown-lineage.png",
        project: "",
        created_at: "2026-01-02T10:00:00.000Z",
      },
      {
        capture_id: "CAP-BROKEN-REFERENCES",
        filename: "broken-references.png",
        batch_id: "BATCH-MISSING",
        request_id: "REQ-MISSING",
        session_id: "SESSION-002",
        project: "SYNTHETIC-WEDDING",
        created_at: "2026-01-03T10:00:00.000Z",
      },
    ],
    batches: [
      {
        batch_id: "BATCH-001",
        project: "SYNTHETIC-WEDDING",
        status: "REVIEW_READY",
        human_status: "PENDING",
        subjects: ["SYNTHETIC-SUBJECT"],
        created_at: "2026-01-01T09:00:00.000Z",
      },
      {
        batch_id: "BATCH-EMPTY-PROJECT",
        project: "",
        status: "RESOLVED",
        human_status: "APPROVED",
        subjects: [],
        created_at: "2026-01-02T09:00:00.000Z",
      },
    ],
    requests: [
      {
        request_id: "REQ-001",
        session_id: "SESSION-001",
        project: "SYNTHETIC-WEDDING",
      },
    ],
    reviews: [
      {
        review_id: "REVIEW-001",
        capture_id: "CAP-001",
        human_status: "PENDING",
      },
      {
        review_id: "REVIEW-ORPHAN",
        capture_id: "CAP-NOT-PRESENT",
        human_status: "PENDING",
      },
    ],
    result_memory: [
      {
        result_id: "RESULT-001",
        capture_id: "CAP-001",
      },
      {
        result_id: "RESULT-ORPHAN",
        capture_id: "CAP-NOT-PRESENT",
      },
    ],
    assets: [
      {
        asset_id: "ASSET-ORPHAN",
        capture_id: "CAP-NOT-PRESENT",
      },
    ],
  };
}
