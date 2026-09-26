import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitNextSteps, type NextStep } from '../lib/next-steps'
import { formatDuration, relativeTime } from '../lib/format'
import { capRenderedOutput } from '../../../shared/src/output-budget'

interface TaskContextResponse {
  task: {
    id?: string
    identifier: string
    title: string
    status: string
    description: string | null
    descriptionMarkdown?: string | null
    milestone?: {
      id: string
      name: string
      /** LUM-714: active | completed | archived — no stored status any more. */
      state: 'active' | 'completed' | 'archived'
      targetDate: string | null
      description?: string | null
    } | null
  }
  memorySection?: string
  /** LUM-844: one-line-per-memory index, printed by default; absent on older
   *  servers (the full memorySection prints instead). */
  memoryIndexSection?: string
  criteriaSection?: string
  /** LUM-807: "## Test cases" nudge; absent on older servers. */
  testCaseSection?: string
  slackContextSection?: string
  webLinkSection?: string
  figmaSection?: string
  artifactSection?: string
  docSection?: string
  commentsSection?: string
  prSection?: string
  prReviewTodosSection?: string
  lineageSection?: string
  /** Absent on older servers — the block is simply omitted (LUM-686). */
  nextSteps?: NextStep[]
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

/** LUM-844: `full` restores the full memory bodies and the judged-used
 *  footer; `currentSessionId` hides the calling session from the prior-session
 *  list (it is always "just now · (no summary)" — noise, not history). */
export interface TaskContextFormatOptions {
  full?: boolean | undefined
  currentSessionId?: string | undefined
}

export async function taskContext(
  identifier: string | undefined,
  options?: { hints?: boolean; full?: boolean }
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

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
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
  process.stdout.write(
    formatTaskContextMarkdown(data, now, {
      full: options?.full,
      currentSessionId: process.env.CLAUDE_CODE_SESSION_ID,
    })
  )
  // Emitted outside the rendered markdown so the output budget can never drop
  // it — the closing "so do this now" line is the cheapest section here.
  emitNextSteps(data.nextSteps ?? [], options ?? {})
}

/**
 * Render a TaskContextResponse as the agent-facing markdown handoff. Pure
 * function; the `now` parameter makes "X ago" phrasing deterministic in
 * tests.
 */
export function formatTaskContextMarkdown(
  data: TaskContextResponse,
  now: Date,
  opts: TaskContextFormatOptions = {}
): string {
  const lines: string[] = []
  lines.push(`# Task: ${data.task.identifier}`)
  lines.push(`**Title**: ${sanitizeField(data.task.title)}`)
  lines.push(`**Status**: ${data.task.status}`)
  if (data.task.milestone) {
    const target = data.task.milestone.targetDate
      ? `, target ${data.task.milestone.targetDate.slice(0, 10)}`
      : ''
    lines.push(
      `**Milestone**: ${sanitizeField(data.task.milestone.name)} (${data.task.milestone.state}${target})`
    )
    const milestoneGoal = data.task.milestone.description
    if (milestoneGoal && milestoneGoal.trim().length > 0) {
      lines.push(`**Milestone goal**: ${sanitizeField(milestoneGoal)}`)
    }
  }
  const body = data.task.descriptionMarkdown ?? data.task.description
  if (body && body.trim().length > 0) {
    lines.push(`**Description**: ${sanitizeField(body)}`)
  }
  lines.push('')

  // The acceptance contract leads (LUM-342): it's what the work is judged
  // against, so it reads as part of the task statement itself.
  if (data.criteriaSection && data.criteriaSection.trim().length > 0) {
    lines.push(sanitizeField(data.criteriaSection.trimEnd()))
    lines.push('')
  }
  // LUM-807: the test-case nudge, same slot as at session start.
  if (data.testCaseSection && data.testCaseSection.trim().length > 0) {
    lines.push(sanitizeField(data.testCaseSection.trimEnd()))
    lines.push('')
  }

  // Frontload memory before sessions: it's cold context the agent should see
  // first. Server returns "" when empty, in which case we skip the section.
  // LUM-844: by default the headline index (bodies one `memory show` away);
  // `--full`, or an older server without the index, prints the full cards.
  const memory =
    !opts.full && data.memoryIndexSection !== undefined
      ? data.memoryIndexSection
      : data.memorySection
  if (memory && memory.trim().length > 0) {
    lines.push(sanitizeField(memory.trimEnd()))
    lines.push('')
  }

  if (data.slackContextSection && data.slackContextSection.trim().length > 0) {
    lines.push(sanitizeField(data.slackContextSection.trimEnd()))
    lines.push('')
  }

  if (data.webLinkSection && data.webLinkSection.trim().length > 0) {
    lines.push(sanitizeField(data.webLinkSection.trimEnd()))
    lines.push('')
  }

  if (data.figmaSection && data.figmaSection.trim().length > 0) {
    lines.push(sanitizeField(data.figmaSection.trimEnd()))
    lines.push('')
  }

  if (data.artifactSection && data.artifactSection.trim().length > 0) {
    lines.push(sanitizeField(data.artifactSection.trimEnd()))
    lines.push('')
  }

  if (data.docSection && data.docSection.trim().length > 0) {
    lines.push(sanitizeField(data.docSection.trimEnd()))
    lines.push('')
  }

  if (data.commentsSection && data.commentsSection.trim().length > 0) {
    lines.push(sanitizeField(data.commentsSection.trimEnd()))
    lines.push('')
  }

  if (data.prSection && data.prSection.trim().length > 0) {
    lines.push(sanitizeField(data.prSection.trimEnd()))
    lines.push('')
  }

  if (
    data.prReviewTodosSection &&
    data.prReviewTodosSection.trim().length > 0
  ) {
    lines.push(sanitizeField(data.prReviewTodosSection.trimEnd()))
    lines.push('')
  }

  const sessions = opts.currentSessionId
    ? data.sessions.filter(s => s.id !== opts.currentSessionId)
    : data.sessions
  if (sessions.length === 0) {
    lines.push('## Previous Sessions (0)')
    lines.push('')
    lines.push('_No prior coding sessions for this task._')
    lines.push('')
  } else {
    lines.push(`## Previous Sessions (${sessions.length})`)
    lines.push('')

    for (const s of sessions) {
      const shortId = s.id.slice(0, 8)
      const ago = relativeTime(new Date(s.lastActivityAt), now)
      const dur = formatDuration(s.durationMs)
      lines.push(`### Session ${shortId} · ${ago} · ${dur}`)
      lines.push(`**Summary**: ${sanitizeField(s.headline)}`)
      if (s.unresolved.length > 0) {
        lines.push('**Unresolved**:')
        for (const u of s.unresolved) lines.push(`- ${sanitizeField(u)}`)
      }
      lines.push('')
    }
  }

  // Flywheel signal goes last so it reads as a closing "historical payoff"
  // footer (LUM-278). Server returns "" below the cold-start floor.
  // LUM-844: a per-fragment audit table, not start-of-work information — by
  // default one pointer line, the table itself under `--full`.
  if (data.lineageSection && data.lineageSection.trim().length > 0) {
    lines.push(
      opts.full
        ? sanitizeField(data.lineageSection.trimEnd())
        : `_Memory usefulness (judged-used track record): lumo task context ${data.task.identifier} --full_`
    )
    lines.push('')
  }

  // A memory-rich task with a long comment thread and many sessions is the
  // single most context-hungry agent-facing command (LUM-428). Cap the
  // assembled handoff to the output budget; the pointer routes the agent to the
  // precise sub-commands to pull any dropped section just-in-time.
  const id = data.task.identifier
  return capRenderedOutput(lines.join('\n'), {
    fetchHint:
      `pull the dropped sections individually: lumo task status ${id} · ` +
      `lumo task comments list ${id} --full · lumo task lineage ${id} · ` +
      `lumo doc show <doc>`,
    unitNoun: 'lines',
  }).text
}
