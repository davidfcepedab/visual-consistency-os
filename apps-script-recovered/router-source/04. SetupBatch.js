/**
 * Backward-compatible entry point.
 * Use setupAutomation() as the canonical setup function.
 */
function setupBatchAutomation() {
  return setupAutomation();
}

function testUniversalInboxPipeline() {
  const result = runUniversalInboxPipeline();
  console.log(JSON.stringify(result, null, 2));
  return result;
}
