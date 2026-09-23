import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'

/** LUM-821: workspace tags — list with usage counts, create with a color. */

export interface TagRow {
  id: string
  name: string
  color: string | null
  taskCount: number
  documentCount: number
}

/** `name  #color  N tasks  M docs`, padded like the other list commands. */
export function formatTagList(tags: TagRow[]): string {
  if (tags.length === 0) return 'No tags.'
  const rows = tags.map(t => ({
    name: sanitizeField(t.name),
    color: t.color ?? '-',
    tasks: `${t.taskCount} ${t.taskCount === 1 ? 'task' : 'tasks'}`,
    docs: `${t.documentCount} ${t.documentCount === 1 ? 'doc' : 'docs'}`,
  }))
  const w = {
    name: Math.max(...rows.map(r => r.name.length)),
    color: Math.max(...rows.map(r => r.color.length)),
    tasks: Math.max(...rows.map(r => r.tasks.length)),
  }
  return rows
    .map(
      r =>
        `${r.name.padEnd(w.name)}  ${r.color.padEnd(w.color)}  ${r.tasks.padEnd(w.tasks)}  ${r.docs}`
    )
    .join('\n')
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
  process.stdout.write(
    `Created tag "${sanitizeField(r.data.tag.name)}"  (${r.data.tag.id})\n`
  )
}
