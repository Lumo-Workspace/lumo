import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitNextSteps, type NextStep } from '../lib/next-steps'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { autoDownsyncOnAttach } from '../lib/memory-auto'
import { attachWorktreeStep } from '../lib/worktree-attach'

/** Successful bind. `status` is absent on older servers — treat absent as
 *  bound for backward compatibility. */
interface BoundResponse {
  status?: 'bound'
  taskId: string
  taskIdentifier: string
  taskTitle: string
  retaggedEventCount: number
  memorySection: string
  /** Dependency blocker warning (LUM-172). Absent on older servers. */
  blockerWarningSection?: string
  /** Undispositioned security findings (LUM-737). Absent on older servers. */
  securityFindingsSection?: string
  /** Acceptance contract (or draft nudge); absent on older servers. */
  criteriaSection?: string
  /** LUM-807: "## Test cases" nudge; absent on older servers. */
  testCaseSection?: string
  /** Absent on older servers — the block is simply omitted (LUM-686). */
  nextSteps?: NextStep[]
}

/** LUM-640: successful steward (milestone) bind. */
interface StewardBoundResponse {
  status?: 'bound'
  role: 'STEWARD'
  milestoneId: string
  milestoneName: string
  /** LUM-647: prior-milestone learnings distilled from earlier close retros. */
  stewardMemorySection?: string
}

/**
 * `lumo session attach <identifier> [--steward]` — bind the currently-running
 * Claude Code session to a task, or (with `--steward`) to a MILESTONE as a
 * STEWARD (governance) session (LUM-640).
 *
 * Required environment: `CLAUDE_CODE_SESSION_ID` (set automatically by
 * Claude Code). Must be invoked from inside a Claude Code session.
 *
 * Both forms are a **lifetime lock** (LUM-459/LUM-640): the binding is
 * write-once. Re-attaching to the *same* task/milestone is an idempotent
 * no-op. Attaching to anything else — a different task, a different
 * milestone, a task after a steward bind, a milestone after a task bind —
 * is refused with HTTP 409; there is no `--force` and no `session detach`;
 * a different binding requires a brand-new Claude Code session.
 *
 * A STEWARD session plans and accepts only: task create/update, criteria
 * set, deps confirm/dismiss, milestone add/remove and all
 * reads pass; `lumo verify` and self-dispatch are refused with 409, and
 * implementation artifacts (commits/PRs) are recorded as boundary crossings.
 */
export async function sessionAttach(
  identifier: string | undefined,
  options?: { steward?: boolean; hints?: boolean; worktree?: boolean }
): Promise<number | void> {
  if (!identifier) {
    console.error(
      options?.steward
        ? 'Error: missing <identifier>. Usage: lumo session attach --steward <milestone id | name | slug>'
        : 'Error: missing <identifier>. Usage: lumo session attach <LUM-42>'
    )
    return 1
  }

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (!sessionId) {
    console.error(
      'Error: $CLAUDE_CODE_SESSION_ID is not set.\n' +
        '`lumo session attach` must be run inside a Claude Code session.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  if (options?.steward) {
    return stewardAttach({
      identifier,
      sessionId,
      apiUrl: resolveAuthedApiUrl(creds.apiUrl),
      token: creds.token,
    })
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}/bind-task`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({ taskIdentifier: identifier }),
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
    let message = 'Not found'
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // fall through
    }
    console.error(`Error: ${sanitizeField(message)}`)
    return 1
  }
  // Lifetime lock (LUM-459): the session is permanently bound to another task —
  // or (LUM-640) it is a STEWARD session bound to a milestone.
  if (res.status === 409) {
    let current = 'another task'
    let stewardMilestone: string | null = null
    try {
      const data = (await res.json()) as {
        currentTaskIdentifier?: string
        currentTaskTitle?: string
        currentMilestoneName?: string
      }
      if (data.currentMilestoneName) {
        stewardMilestone = sanitizeField(data.currentMilestoneName)
      } else if (data.currentTaskIdentifier) {
        current = data.currentTaskTitle
          ? `${data.currentTaskIdentifier} "${sanitizeField(data.currentTaskTitle)}"`
          : data.currentTaskIdentifier
      }
    } catch {
      // fall through with the generic phrasing
    }
    if (stewardMilestone) {
      console.error(
        `Error: this session is a STEWARD (governance) session for milestone "${stewardMilestone}" — ` +
          'it cannot attach a task. Start a new Claude Code session to ' +
          `implement ${identifier}.`
      )
      return 1
    }
    console.error(
      `Error: this session is permanently bound to ${current}. ` +
        'A session works one task for its lifetime — start a new Claude Code ' +
        `session to work on ${identifier}.`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: bind-task failed (HTTP ${res.status})`)
    return 1
  }

  const body = (await res.json()) as BoundResponse

  // LUM-844: one header line — the re-tag count rides along only when non-zero.
  const retagged =
    body.retaggedEventCount > 0
      ? ` · re-tagged ${body.retaggedEventCount} earlier event${
          body.retaggedEventCount === 1 ? '' : 's'
        }`
      : ''
  console.log(
    `Attached session ${sessionId} to ${body.taskIdentifier} "${sanitizeField(body.taskTitle)}"${retagged}`
  )
  // Warnings come before contract/memory: matches the hook injection order —
  // short, actionable information first.
  if (body.blockerWarningSection) {
    console.log('')
    console.log(sanitizeField(body.blockerWarningSection))
  }
  // LUM-737: security findings next — same slot as the hook envelope (after
  // the blocker, before the contract).
  if (body.securityFindingsSection) {
    console.log('')
    console.log(sanitizeField(body.securityFindingsSection))
  }
  // Contract next: it's what the upcoming work is judged against (LUM-342).
  if (body.criteriaSection) {
    console.log('')
    console.log(sanitizeField(body.criteriaSection))
  }
  // LUM-844: memory and the test-case nudge are NOT printed here — `task
  // context`, the next step of the workflow, prints both, and output read at
  // session start is re-read on every later step. One pointer instead; the
  // correctness signals above (blockers, security findings, contract) stay.
  console.log('')
  console.log(
    `Background (team memory, test cases, sources, prior sessions): lumo task context ${body.taskIdentifier}`
  )

  // LUM-551: attach-triggered best-effort downsync. Resolve the bound task's
  // project and refresh team memory (throttle-gated inside autoDownsyncOnAttach).
  // Wrapped + swallowed: a sync failure must never change the attach outcome.
  try {
    const base = trimTrailingSlash(apiUrl)
    const proj = await resolveBoundProjectId(
      apiUrl,
      creds.token,
      body.taskIdentifier
    )
    if (proj.ok) {
      const sync = await autoDownsyncOnAttach({
        cwd: process.cwd(),
        base,
        token: creds.token,
        projectId: proj.id,
        now: new Date(),
      })
      const touched =
        (sync.added ?? 0) + (sync.updated ?? 0) + (sync.removed ?? 0)
      if (!sync.skipped && !sync.error && touched > 0) {
        console.log('')
        console.log(
          sanitizeField(
            `memory sync → +${sync.added} ~${sync.updated} -${sync.removed}` +
              (sync.anchorCandidates
                ? ` · ${sync.anchorCandidates} stale-anchor candidate(s)`
                : '')
          )
        )
      }
    }
  } catch {
    // best-effort — the bind already succeeded; never surface a sync error here
  }

  // LUM-825: local worktree step — report / hint / opt-in create. Purely
  // best-effort: it prints, never throws, never changes the exit code.
  attachWorktreeStep({
    taskId: body.taskIdentifier,
    taskTitle: body.taskTitle,
    create: options?.worktree,
  })

  // Last, after the contract/memory/sync sections — the block reads as the
  // closing "so do this now" line rather than interrupting them (LUM-686).
  emitNextSteps(body.nextSteps ?? [], options ?? {})
}

/**
 * LUM-640: the `--steward` form — bind this session to a MILESTONE as a
 * governance session. Same lifetime-lock error surface as the task form; the
 * success output spells out the allowed/blocked action split so the agent
 * knows its lane without a round-trip to the docs.
 */
async function stewardAttach(args: {
  identifier: string
  sessionId: string
  apiUrl: string
  token: string
}): Promise<number | void> {
  const { identifier, sessionId, apiUrl, token } = args
  const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(sessionId)}/bind-milestone`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ milestoneRef: identifier }),
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
  // 400 (ambiguous reference) and 404 (no match) carry actionable server
  // messages — print them verbatim (sanitized).
  if (res.status === 400 || res.status === 404) {
    let message = res.status === 404 ? 'Not found' : 'Bad request'
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      // fall through
    }
    console.error(`Error: ${sanitizeField(message)}`)
    return 1
  }
  // Lifetime lock: already task-bound, or steward of a different milestone.
  if (res.status === 409) {
    let message = 'this session is already permanently bound'
    try {
      const data = (await res.json()) as {
        error?: string
        currentTaskIdentifier?: string
        currentMilestoneName?: string
      }
      if (data.error) message = data.error
    } catch {
      // fall through with the generic phrasing
    }
    console.error(
      `Error: ${sanitizeField(message)} ` +
        'A session holds one binding for its lifetime — start a new Claude ' +
        'Code session for a different task or milestone.'
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: bind-milestone failed (HTTP ${res.status})`)
    return 1
  }

  const body = (await res.json()) as StewardBoundResponse
  console.log(
    `Attached session ${sessionId} as STEWARD of milestone "${sanitizeField(body.milestoneName)}"`
  )
  console.log('')
  console.log('Governance role — plan & accept only (lifetime lock):')
  console.log(
    '  allowed: task create/update · criteria set (incl. --human) · deps confirm/dismiss · milestone add/remove · all reads'
  )
  console.log(
    '  blocked: lumo verify (409, no round burned) · moving a task to in_progress assigned to yourself · attaching a task'
  )
  console.log(
    '  note:    commits/PRs produced in this session are recorded as boundary crossings (human-reviewed on the web)'
  )
  // LUM-647: prior-milestone learnings distilled from this project's earlier
  // milestone-close retros, injected so the steward carries them into planning.
  if (body.stewardMemorySection && body.stewardMemorySection.trim() !== '') {
    console.log('')
    console.log(sanitizeField(body.stewardMemorySection))
  }
}
