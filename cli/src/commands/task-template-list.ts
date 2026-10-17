import { NONE, emptyState } from '../lib/format'
import { emitJson, listEnvelope } from '../lib/json-output'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { apiCall, apiContext } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'

export interface TaskTemplateListItem {
  key: string
  name: string
  description: string | null
  isSystem: boolean
}

/** Render the template catalog: one line per key, built-ins marked. */
export function formatTaskTemplateList(
  items: TaskTemplateListItem[],
  opts: ListRenderOptions = {}
): string {
  if (items.length === 0) return emptyState('task templates')
  // LUM-1232 batch A: the shared list renderer; the key (what
  // `--template <key>` takes) first, the free-text description last.
  return [
    'Task templates (use with `lumo task create <title> --template <key>`):',
    renderListTable(
      items.map(t => [
        sanitizeField(t.key),
        sanitizeField(t.name),
        t.isSystem ? 'built-in' : 'workspace',
        t.description ? sanitizeField(t.description) : NONE,
      ]),
      { header: ['KEY', 'NAME', 'KIND', 'DESCRIPTION'], flex: 3, ...opts }
    ),
  ].join('\n')
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
    // Batch C: the former bare array is wrapped once (release notes).
    emitJson(listEnvelope('templates', out))
    return
  }
  process.stdout.write(formatTaskTemplateList(r.data.templates) + '\n')
}
