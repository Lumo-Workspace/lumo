/**
 * LUM-1343 — the message id for a Feishu doc import / sync error code (from
 * the API's `code`, or a doc's stored `feishuSyncError`). Unknown codes fall
 * back to the generic message, so a new server code never shows raw.
 */
const KNOWN = new Set([
  'feishu_doc_url_invalid',
  'feishu_doc_unsupported_type',
  'feishu_not_connected',
  'feishu_needs_reauth',
  'feishu_doc_forbidden',
  'feishu_doc_not_found',
  'feishu_scope_missing',
  'feishu_rate_limited',
  'feishu_importer_left',
  'feishu_not_imported',
  'feishu_doc_too_large',
  'not_installed',
  'reinstall_required',
])

export function feishuDocErrorMessageId(
  code: string | null | undefined
): string {
  return code && KNOWN.has(code)
    ? `feishuDocs.error.${code}`
    : 'feishuDocs.error.feishu_sync_failed'
}
