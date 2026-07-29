const STATIC_CONFIG = Object.freeze({
  SPREADSHEET_ID: '1kYsE_9d2V77CC8p2PiMHScwENngRKEvrHd2wooYqFv8',

  SHEETS: {
    REQUESTS: 'REQUESTS',
    REVIEW_QUEUE: 'REVIEW_QUEUE',
    RESULT_MEMORY: 'RESULT_MEMORY',
    ASSET_REGISTRY: 'ASSET_REGISTRY',
    CONFIG: 'CONFIG',
    CAPTURES: 'CAPTURES',
    BATCHES: 'BATCHES',
    FAILURE_MEMORY: 'FAILURE_MEMORY',
  },

  FOLDERS: {
    ROOT: '16cNcCcXIZHVR_YyTEF42G9tE99BNEJf6',

    // Visible Drive name: 00 Universal Inbox
    INBOX: '1yDdDAVD8NpoLFDu-lhJpwqe3P60AjwkA',

    // Visible Drive name: 01 To Score
    TO_SCORE: '1SgNFAy4CtKMV8f32XxLOlo4AMAxcqPxb',

    // Visible Drive name: 02 Human Review
    HUMAN_REVIEW: '1FCaAQSsO7b6VmV1tMXPg3N8fNVdKG1CS',

    // Visible Drive name: 03 Adjustment Required
    ADJUSTMENT: '1ATSewr_IzLxHkVk0Tx-O3YAlXuG3K7jM',

    // Visible Drive name: 04 Approved
    APPROVED: '1uu2vq_3aF6vz_2EaIXtUvchiYdsYmbQY',

    // Visible Drive name: 05 Rejected
    REJECTED: '11ihfI5DgusbA1SWx6JsoFmrRMgAHTvnO',
  },

  DEFAULTS: {
    GEMINI_MODEL: 'gemini-3.6-flash',

    POLL_MINUTES: 5,

    HUMAN_APPROVAL_REQUIRED: true,
    FINAL_REJECT_REQUIRES_HUMAN: true,
    AUTO_ROUTE_ADJUSTMENTS: true,

    AUTO_APPROVE_MIN_IDENTITY: 4.5,
    AUTO_APPROVE_MIN_OVERALL: 4.5,
    AUTO_REJECT_MAX_IDENTITY: 3.79,

    BATCH_MAX_IMAGES: 4,
    BATCH_IDLE_MINUTES: 20,
    MAX_BATCH_CALLS_PER_RUN: 3,

    BATCH_REVIEW_THRESHOLD: 4.4,
    BATCH_IDENTITY_THRESHOLD: 4.3,
    BATCH_ARCHIVE_THRESHOLD: 3.5,
  },
});

function getRuntimeConfig_() {
  const props = PropertiesService.getScriptProperties();

  return {
    geminiApiKey:
      props.getProperty('GEMINI_API_KEY') || '',

    geminiModel:
      props.getProperty('GEMINI_MODEL') ||
      STATIC_CONFIG.DEFAULTS.GEMINI_MODEL,

    pollMinutes:
      Number(
        props.getProperty('POLL_MINUTES') ||
        STATIC_CONFIG.DEFAULTS.POLL_MINUTES
      ),

    batchMaxImages:
      Number(
        props.getProperty('BATCH_MAX_IMAGES') ||
        STATIC_CONFIG.DEFAULTS.BATCH_MAX_IMAGES
      ),

    batchIdleMinutes:
      Number(
        props.getProperty('BATCH_IDLE_MINUTES') ||
        STATIC_CONFIG.DEFAULTS.BATCH_IDLE_MINUTES
      ),

    maxBatchCallsPerRun:
      Number(
        props.getProperty('MAX_BATCH_CALLS_PER_RUN') ||
        STATIC_CONFIG.DEFAULTS.MAX_BATCH_CALLS_PER_RUN
      ),

    batchReviewThreshold:
      Number(
        props.getProperty('BATCH_REVIEW_THRESHOLD') ||
        STATIC_CONFIG.DEFAULTS.BATCH_REVIEW_THRESHOLD
      ),

    batchIdentityThreshold:
      Number(
        props.getProperty('BATCH_IDENTITY_THRESHOLD') ||
        STATIC_CONFIG.DEFAULTS.BATCH_IDENTITY_THRESHOLD
      ),

    batchArchiveThreshold:
      Number(
        props.getProperty('BATCH_ARCHIVE_THRESHOLD') ||
        STATIC_CONFIG.DEFAULTS.BATCH_ARCHIVE_THRESHOLD
      ),
  };
}