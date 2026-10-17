import { emptyState } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { colorEnabled, style } from '../lib/ui'
import { successLine } from '../lib/feedback'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'

/** LUM-821: workspace tags — list with usage counts, create with a color. */

export interface TagRow {
  id: string
  name: string
  color: string | null
  taskCount: number
  documentCount: number
}

/**
 * `name  #color  N tasks  M docs`, aligned by display width via the shared
 * list table (LUM-1086 / LUM-1089: header on a TTY only). Usage counts are
 * dimmed on a colour TTY only; names are sanitized before any styling.
 */
export function formatTagList(
  tags: TagRow[],
  opts: ListRenderOptions = {}
): string {
  if (tags.length === 0) return emptyState('tags')
  const color = opts.color ?? colorEnabled()
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`
  return renderListTable(
    tags.map(t => [
      sanitizeField(t.name),
      t.color ?? '-',
      style.dim(plural(t.taskCount, 'task'), color),
      style.dim(plural(t.documentCount, 'doc'), color),
    ]),
    { header: ['NAME', 'COLOR', 'TASKS', 'DOCS'], flex: 0, ...opts, color }
  )
}

/** `lumo tag list [--json]` */
export async function tagList(
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ tags: TagRow[] }>(ctx, '/api/tags', {}, 'tag list')
  if (!r.ok || !r.data) return 1
  const tags = [...r.data.tags].sort((a, b) => a.name.localeCompare(b.name))
  if (opts.json) {
    process.stdout.write(JSON.stringify(tags, null, 2) + '\n')
    return
  }
  process.stdout.write(formatTagList(tags) + '\n')
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** `lumo tag create <name> [--color #rrggbb]` */
export async function tagCreate(
  name: string,
  opts: { color?: string } = {}
): Promise<number | void> {
  const trimmed = name.trim()
  if (!trimmed) {
    console.error('Error: tag name must not be empty')
    return 1
  }
  if (trimmed.length > 30) {
    console.error('Error: tag name must be at most 30 characters')
    return 1
  }
  if (opts.color !== undefined && !COLOR_RE.test(opts.color)) {
    console.error(`Error: --color expects #rrggbb, got "${opts.color}"`)
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ tag: { id: string; name: string } }>(
    ctx,
    '/api/tags',
    {
      method: 'POST',
      json: { name: trimmed, ...(opts.color ? { color: opts.color } : {}) },
    },
    'tag create'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(formatCreatedTagLine(r.data.tag) + '\n')
}

/** LUM-1092: `Created tag "<name>"`. LUM-1230: tags are referenced by
 *  name (`--tag <name>`), so the cuid is not printed. */
export function formatCreatedTagLine(tag: {
  id: string
  name: string
}): string {
  return successLine({
    verb: 'Created',
    kind: 'tag',
    title: tag.name,
  })
}
