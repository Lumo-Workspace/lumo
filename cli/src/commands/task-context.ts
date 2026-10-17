import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitNextSteps, type NextStep } from '../lib/next-steps'
import { fmtCalendarDay, fmtInstant, formatDuration } from '../lib/format'
import { capRenderedOutput } from '../../../shared/src/output-budget'
import { resolveSessionId } from '../lib/session-id'
import {
  TASK_DESCRIPTION_FENCE,
  TASK_DESCRIPTION_PREAMBLE,
  fenceUntrustedText,
  renderSessionRecapFence,
  renderSessionRecapFollowUps,
} from '../../../shared/src/untrusted-fence'
import { neutralizeWrapperEscapes } from '../../../shared/src/untrusted-content'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

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
  /** LUM-998: the description, already fenced + guarded server-side
   *  (redacted too); absent on older servers. */
  descriptionSection?: string
  memorySection?: string
  /** LUM-844: one-line-per-memory index, printed by default; absent on older
   *  servers (the full memorySection prints instead). */
  memoryIndexSection?: string
  /** LUM-923: pending workspace deletion notice; absent on older servers. */
  workspaceNoticeSection?: string
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
    console.error(errNotLoggedIn())
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
    console.error(errHttp('context fetch', res.status))
    return 1
  }

  const data = (await res.json()) as TaskContextResponse
  const now = new Date()
  process.stdout.write(
    formatTaskContextMarkdown(data, now, {
      full: options?.full,
      currentSessionId: await resolveSessionId({ write: false }),
    })
  )
  // Emitted outside the rendered markdown so the output budget can never drop
  // it — the closing "so do this now" line is the cheapest section here.
  emitNextSteps(data.nextSteps ?? [], options ?? {})
}

/**
 * Render a TaskContextResponse as the agent-facing markdown handoff. Pure
 * apart from the TTY check of {@link fmtInstant}. `_now` is kept for callers;
 * since LUM-1232 times are absolute, so it no longer affects the output.
 */
export function formatTaskContextMarkdown(
  data: TaskContextResponse,
  _now: Date,
  opts: TaskContextFormatOptions = {}
): string {
  const lines: string[] = []
  lines.push(`# Task: ${data.task.identifier}`)
  lines.push(`**Title**: ${sanitizeField(data.task.title)}`)
  lines.push(`**Status**: ${data.task.status}`)
  if (data.task.milestone) {
    const target = data.task.milestone.targetDate
      ? `, target ${fmtCalendarDay(data.task.milestone.targetDate)}`
      : ''
    lines.push(
      `**Milestone**: ${sanitizeField(data.task.milestone.name)} (${data.task.milestone.state}${target})`
    )
    const milestoneGoal = data.task.milestone.description
    if (milestoneGoal && milestoneGoal.trim().length > 0) {
      lines.push(`**Milestone goal**: ${sanitizeField(milestoneGoal)}`)
    }
  }
  lines.push('')

  // LUM-998: the description prints inside its own fence. A current server
  // sends it guarded (secret redaction included); an older one does not, so
  // the CLI applies the shared half of the guard itself.
  const description =
    data.descriptionSection !== undefined
      ? sanitizeField(data.descriptionSection)
      : fenceUntrustedText(
          TASK_DESCRIPTION_FENCE,
          TASK_DESCRIPTION_PREAMBLE,
          data.task.descriptionMarkdown ?? data.task.description ?? ''
        )
  if (description.trim().length > 0) {
    lines.push(description.trimEnd())
    lines.push('')
  }

  // LUM-923: a pending workspace deletion comes before the work itself.
  if (
    data.workspaceNoticeSection &&
    data.workspaceNoticeSection.trim().length > 0
  ) {
    lines.push(sanitizeField(data.workspaceNoticeSection.trimEnd()))
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
    // LUM-1067: one untrusted fence around every recap, and each session's
    // open items as candidate follow-ups with a scope check — a recap can
    // carry an ask an earlier session read in untrusted content. The server
    // already guards each line; defanging again here keeps an older server's
    // line from closing the fence.
    const recapLine = (text: string) =>
      neutralizeWrapperEscapes(sanitizeField(text))
    const recaps: string[] = []
    for (const s of sessions) {
      const shortId = s.id.slice(0, 8)
      // LUM-1232 (T-1/T-2): absolute time only — no `2 days ago`.
      const at = fmtInstant(s.lastActivityAt)
      const dur = formatDuration(s.durationMs)
      recaps.push(`### Session ${shortId} · ${at} · ${dur}`)
      recaps.push(`**Summary**: ${recapLine(s.headline)}`)
      recaps.push(...renderSessionRecapFollowUps(s.unresolved.map(recapLine)))
      recaps.push('')
    }
    // iteration 2: close with the done / not-done report line when any
    // session left items open, so an undone follow-up is surfaced, not dropped.
    const hasFollowUps = sessions.some(s => s.unresolved.length > 0)
    lines.push(renderSessionRecapFence(recaps.join('\n'), hasFollowUps))
    lines.push('')
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
