import { emptyState, fmtTimestamp } from '../lib/format'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'

/** One row of `GET /api/drafts` — the web composer's saved form snapshot. */
export interface DraftRow {
  id: string
  type: string
  data: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

/** The draft's title (TASK) or name (PROJECT); `(untitled)` when blank. */
export function draftTitle(d: DraftRow): string {
  const raw = d.data?.[d.type === 'PROJECT' ? 'name' : 'title']
  const text =
    typeof raw === 'string'
      ? sanitizeField(raw).replace(/\s+/g, ' ').trim()
      : ''
  return text || '(untitled)'
}

/**
 * Drafts as a `TYPE  UPDATED  TITLE` table — LUM-1230: no command takes a
 * draft id, so the cuid column is gone (`--json` keeps it). LUM-1089 shape: header on a
 * TTY only; newest first as the server returns them.
 */
export function formatDraftList(
  drafts: DraftRow[],
  opts: ListRenderOptions = {}
): string {
  if (drafts.length === 0) return emptyState('drafts')
  return renderListTable(
    drafts.map(d => [d.type, fmtTimestamp(d.updatedAt), draftTitle(d)]),
    { header: ['TYPE', 'UPDATED', 'TITLE'], flex: 2, ...opts }
  )
}

/** `lumo draft list` (LUM-1192) — your own unsent task / project drafts. */
export async function draftList(
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ drafts: DraftRow[] }>(
    ctx,
    '/api/drafts',
    {},
    'draft list'
  )
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(r.data, null, 2) + '\n')
    return
  }
  process.stdout.write(formatDraftList(r.data.drafts) + '\n')
}
