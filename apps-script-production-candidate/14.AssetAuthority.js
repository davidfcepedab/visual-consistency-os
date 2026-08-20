/**
 * VISUAL IDENTITY OS — ASSET INDEX AUTHORITY UPDATE
 *
 * The one write path this project was missing: correcting
 * status/approval_state on a row in the Prompt Generator's `13_Asset_Index`
 * (an EXTERNAL spreadsheet from Automation Control's own sheet) so that a
 * governance decision — not a folder move alone — is what the Reference
 * Resolver treats as authority. Physical Drive location is never sufficient
 * on its own (see governance principle: "Ubicación en Priority 0 no basta
 * para otorgar autoridad").
 *
 * Safety model, mirroring visual_plan_library_reconciliation's dry_run
 * convention already in this codebase:
 *   - dry_run=true (default): returns a preview diff, writes nothing.
 *   - dry_run=false: performs the write, inside withLock_, one row at a time,
 *     matched by exact "Asset" column value (never by row index/position).
 * Every write appends a provenance line to Notes; it never silently
 * discards the prior text.
 */

function updateAssetIndexAuthority_(payload) {
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  if (!assets.length) {
    throw new Error('assets array is required');
  }
  const approvedBy = String(payload.approved_by || '').trim();
  const decisionAt = String(payload.decision_at || nowIso_());
  const dryRun = payload.dry_run !== false; // default true — must opt out explicitly

  if (!dryRun && !approvedBy) {
    throw new Error(
      'approved_by is required for a real (non-dry-run) authority update'
    );
  }

  return withLock_(() => {
    const spreadsheet = SpreadsheetApp.openById(
      STATIC_CONFIG.PROMPT_GENERATOR_SPREADSHEET_ID
    );
    const sheet = spreadsheet.getSheetByName(
      STATIC_CONFIG.SHEETS.ASSET_INDEX
    );
    if (!sheet) {
      throw new Error('13_Asset_Index sheet is missing');
    }

    const lastCol = sheet.getLastColumn();
    const headers = sheet
      .getRange(1, 1, 1, lastCol)
      .getValues()[0]
      .map(h => String(h || '').trim());
    const colIndex = name => headers.indexOf(name) + 1; // 1-based, 0 = not found

    const assetCol = colIndex('Asset');
    if (!assetCol) {
      throw new Error('Asset column not found in 13_Asset_Index');
    }

    const lastRow = sheet.getLastRow();
    const assetNames = sheet
      .getRange(2, assetCol, lastRow - 1, 1)
      .getValues()
      .map(r => String(r[0] || '').trim());

    const results = [];

    assets.forEach(item => {
      const wantedName = String(item.asset_name || '').trim();
      const rowOffset = assetNames.indexOf(wantedName);
      if (rowOffset === -1) {
        results.push({
          asset_name: wantedName,
          found: false,
          error: 'No exact match in Asset column',
        });
        return;
      }
      const row = rowOffset + 2; // header row is 1, data starts at 2

      const current = {};
      headers.forEach((h, i) => {
        if (h) {
          current[h] = sheet.getRange(row, i + 1).getValue();
        }
      });

      const proposed = {
        Status: item.status || current.Status,
        Type: item.type || current.Type,
        Version: item.version || current.Version,
        Folder: item.folder || current.Folder,
      };

      const provenanceLine =
        `AUTHORITY UPDATE ${decisionAt} by ${approvedBy || '(dry-run, not applied)'}` +
        `: ${item.provenance_note || 'promoted per human decision'}.`;
      const newNotes = current.Notes
        ? `${current.Notes} | ${provenanceLine}`
        : provenanceLine;

      if (!dryRun) {
        if (colIndex('Status')) {
          sheet.getRange(row, colIndex('Status')).setValue(proposed.Status);
        }
        if (colIndex('Type')) {
          sheet.getRange(row, colIndex('Type')).setValue(proposed.Type);
        }
        if (colIndex('Version')) {
          sheet.getRange(row, colIndex('Version')).setValue(proposed.Version);
        }
        if (colIndex('Folder')) {
          sheet.getRange(row, colIndex('Folder')).setValue(proposed.Folder);
        }
        if (colIndex('Notes')) {
          sheet.getRange(row, colIndex('Notes')).setValue(newNotes);
        }
      }

      results.push({
        asset_name: wantedName,
        found: true,
        row,
        current,
        proposed: Object.assign({}, proposed, { Notes: newNotes }),
        applied: !dryRun,
      });
    });

    return {
      ok: true,
      dry_run: dryRun,
      approved_by: approvedBy || null,
      decision_at: decisionAt,
      results,
    };
  });
}
