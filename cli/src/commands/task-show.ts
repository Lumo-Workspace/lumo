import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { localDayLabel } from '../lib/local-day'
import {
  TASK_DESCRIPTION_FENCE,
  TASK_DESCRIPTION_PREAMBLE,
  fenceUntrustedText,
} from '../../../shared/src/untrusted-fence'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  fieldLines,
  type Field,
  type LayoutOptions,
} from '../lib/report-layout'
import { colorEnabled, heading, terminalWidth } from '../lib/ui'

interface ShowResponse {
  task: {
    id: string
    identifier: string
    title: string
    status: string
    priority: string
    description: string | null
    descriptionMarkdown?: string | null
    url: string
    project: { id: string; name: string }
    assignee: {
      type: 'member' | 'agent'
      label: string
      email: string | null
    } | null
    /** LUM-821 — optional so an older server still renders. */
    dueDate?: string | null
  }
}

/**
 * Render task detail: the `<id>  <title>` header (bold on a TTY), then
 * `Label:  value` rows padded to the widest label (LUM-1090, the LUM-1091
 * grammar; the URL is never wrapped). The description follows in its own
 * `<untrusted-task-description>` fence (LUM-998): member-authored text,
 * wrapper tags defanged and directive-shaped content flagged at the head —
 * printed verbatim, never re-wrapped (it is Markdown).
 */
export function formatTaskShow(
  task: ShowResponse['task'],
  opts: LayoutOptions = {}
): string {
  const lines: string[] = [
    heading(`${task.identifier}  ${sanitizeField(task.title)}`, {
      color: opts.color === true,
    }),
  ]
  let assignee = '(unassigned)'
  if (task.assignee) {
    const label = sanitizeField(task.assignee.label)
    assignee =
      task.assignee.email && task.assignee.type === 'member'
        ? `${label} <${sanitizeField(task.assignee.email)}>`
        : label
  }
  const fields: Field[] = [
    { label: 'Status', value: task.status },
    { label: 'Priority', value: task.priority },
    { label: 'Project', value: sanitizeField(task.project.name) },
    { label: 'Assignee', value: assignee },
  ]
  if (task.dueDate)
    fields.push({ label: 'Due', value: localDayLabel(task.dueDate) })
  fields.push({ label: 'URL', value: task.url, whole: true })
  lines.push(...fieldLines(fields, 0, opts))
  const description = fenceUntrustedText(
    TASK_DESCRIPTION_FENCE,
    TASK_DESCRIPTION_PREAMBLE,
    task.descriptionMarkdown ?? task.description ?? ''
  )
  if (description) {
    lines.push('')
    lines.push(description)
  }
  return lines.join('\n')
}

export async function taskShow(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error('Error: missing <identifier>. Usage: lumo task show <LUM-42>')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('task show', res.status))
    return 1
  }

  const data = (await res.json()) as ShowResponse
  process.stdout.write(
    formatTaskShow(data.task, {
      width: terminalWidth(),
      color: colorEnabled(),
    }) + '\n'
  )
}
