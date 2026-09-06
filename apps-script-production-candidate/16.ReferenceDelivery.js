/**
 * Returns one exact, registered image as base64 for the MCP host handoff.
 * This is a read-only transport operation; it grants no authority.
 */
function getReferenceImageSafe_(fileId) {
  const exactId = String(fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(exactId)) {
    throw Object.assign(new Error('Invalid reference file_id'), { code: 'INVALID_ARGUMENT' });
  }

  const context = getGenerationContextSafe_();
  if (!context || context.ok !== true || !context.snapshot) {
    throw Object.assign(new Error('Generation context unavailable'), { code: 'BACKEND_ERROR' });
  }
  const records = []
    .concat(context.snapshot.asset_registry || [])
    .concat(context.snapshot.asset_index || [])
    .concat(context.snapshot.captures || []);
  const known = records.some(record => firstDriveIdSafe_([
    record.source_file_id,
    record.file_id,
    record.drive_url,
    record['Drive Link'],
    record.asset_link,
  ]) === exactId);
  if (!known) {
    throw Object.assign(new Error('Reference is not registered'), { code: 'NOT_FOUND' });
  }

  const file = DriveApp.getFileById(exactId);
  const blob = file.getBlob();
  const mimeType = String(blob.getContentType() || file.getMimeType() || '');
  if (!mimeType.startsWith('image/')) {
    throw Object.assign(new Error('Reference is not an image'), { code: 'INVALID_ARGUMENT' });
  }
  const bytes = blob.getBytes();
  if (bytes.length > 8 * 1024 * 1024) {
    throw Object.assign(new Error('Reference image exceeds 8 MiB delivery limit'), { code: 'RESOURCE_EXHAUSTED' });
  }
  return {
    ok: true,
    file_id: exactId,
    file_name: file.getName(),
    mime_type: mimeType,
    data_base64: Utilities.base64Encode(bytes),
  };
}
