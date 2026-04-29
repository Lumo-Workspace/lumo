import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

interface TaskContextResponse {
  task: {
    id: string
    identifier: string
    title: string
    status: string
    description: string | null
  }
  memorySection?: string
  sessions: Array<{
    id: string
    startedAt: string
    lastActivityAt: string
    durationMs: number
    eventCount: number
    summaryType: string | null
    headline: string
    unresolved: string[]
  }>
}

export async function taskContext(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task context <LUM-42>'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/context/${encodeURIComponent(identifier)}`

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
    console.error(`Error: context fetch failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as TaskContextResponse
  const now = new Date()
  process.stdout.write(formatTaskContextMarkdown(data, now))
}

/**
 * Render a TaskContextResponse as the agent-facing markdown handoff. Pure
 * function; the `now` parameter makes "X ago" phrasing deterministic in
 * tests.
 */
export function formatTaskContextMarkdown(
  data: TaskContextResponse,
  now: Date
): string {
  const lines: string[] = []
  lines.push(`# Task: ${data.task.identifier}`)
  lines.push(`**Title**: ${data.task.title}`)
  lines.push(`**Status**: ${data.task.status}`)
  if (data.task.description && data.task.description.trim().length > 0) {
    lines.push(`**Description**: ${data.task.description}`)
  }
  lines.push('')

  // Frontload memory before sessions: it's cold context the agent should see
  // first. Server returns "" when empty, in which case we skip the section.
  if (data.memorySection && data.memorySection.trim().length > 0) {
    lines.push(data.memorySection.trimEnd())
    lines.push('')
  }

  if (data.sessions.length === 0) {
    lines.push('## Previous Sessions (0)')
    lines.push('')
    lines.push('_No prior coding sessions for this task._')
    lines.push('')
    return lines.join('\n')
  }

  lines.push(`## Previous Sessions (${data.sessions.length})`)
  lines.push('')

  for (const s of data.sessions) {
    const shortId = s.id.slice(0, 8)
    const ago = relativeTime(new Date(s.lastActivityAt), now)
    const dur = formatDuration(s.durationMs)
    lines.push(`### Session ${shortId} · ${ago} · ${dur}`)
    lines.push(`**Summary**: ${s.headline}`)
    if (s.unresolved.length > 0) {
      lines.push('**Unresolved**:')
      for (const u of s.unresolved) lines.push(`- ${u}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatDuration(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))}s`
  }
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes}min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}min`
}

function relativeTime(then: Date, now: Date): string {
  const diffMs = now.getTime() - then.getTime()
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
