import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { localDayLabel } from '../lib/local-day'

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
 * Render task detail as a key:value block. Multi-line description is
 * indented under a `Description:` label so the structure stays scannable.
 */
export function formatTaskShow(task: ShowResponse['task']): string {
  const lines: string[] = []
  lines.push(`${task.identifier}  ${sanitizeField(task.title)}`)
  lines.push(`Status:    ${task.status}`)
  lines.push(`Priority:  ${task.priority}`)
  lines.push(`Project:   ${sanitizeField(task.project.name)}`)
  if (task.assignee) {
    const label = sanitizeField(task.assignee.label)
    const detail =
      task.assignee.email && task.assignee.type === 'member'
        ? `${label} <${sanitizeField(task.assignee.email)}>`
        : label
    lines.push(`Assignee:  ${detail}`)
  } else {
    lines.push('Assignee:  (unassigned)')
  }
  if (task.dueDate) lines.push(`Due:       ${localDayLabel(task.dueDate)}`)
  lines.push(`URL:       ${task.url}`)
  const body = task.descriptionMarkdown ?? task.description
  if (body && body.trim().length > 0) {
    lines.push('')
    lines.push('Description:')
    for (const line of sanitizeField(body).split('\n')) {
      lines.push(`  ${line}`)
    }
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
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: task show failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as ShowResponse
  process.stdout.write(formatTaskShow(data.task) + '\n')
}
