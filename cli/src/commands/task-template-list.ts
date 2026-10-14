import { emptyState } from '../lib/format'
import { apiCall, apiContext } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'

export interface TaskTemplateListItem {
  key: string
  name: string
  description: string | null
  isSystem: boolean
}

/** Render the template catalog: one line per key, built-ins marked. */
export function formatTaskTemplateList(items: TaskTemplateListItem[]): string {
  if (items.length === 0) return emptyState('task templates')
  const w = Math.max(...items.map(t => t.key.length))
  const lines = [
    'Task templates (use with `lumo task create <title> --template <key>`):',
  ]
  for (const t of items) {
    const tag = t.isSystem ? ' [built-in]' : ''
    const desc = t.description ? ` — ${sanitizeField(t.description)}` : ''
    lines.push(
      `  ${sanitizeField(t.key).padEnd(w)}  ${sanitizeField(t.name)}${tag}${desc}`
    )
  }
  return lines.join('\n')
}

/** `lumo task template list` — system + workspace task templates (LUM-970). */
export async function taskTemplateList(
  opts: { json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{
    templates: Array<TaskTemplateListItem & { content: string }>
  }>(ctx, '/api/task-templates', {}, 'task template list')
  if (!r.ok || !r.data) return 1
  if (opts.json) {
    const out = r.data.templates.map(t => ({
      key: t.key,
      name: t.name,
      description: t.description,
      isSystem: t.isSystem,
      content: t.content,
    }))
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    return
  }
  process.stdout.write(formatTaskTemplateList(r.data.templates) + '\n')
}
