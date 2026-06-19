import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { autoDownsyncOnAttach } from '../lib/memory-auto'

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
  /** Acceptance contract (or draft nudge); absent on older servers. */
  criteriaSection?: string
}

/**
 * `lumo session attach <identifier>` — bind the currently-running
 * Claude Code session to a task.
 *
 * Required environment: `CLAUDE_CODE_SESSION_ID` (set automatically by
 * Claude Code). Must be invoked from inside a Claude Code session.
 *
 * The binding is a **lifetime lock** (LUM-459): `Session.taskId` is write-once.
 * Re-attaching to the *same* task is an idempotent no-op (re-emits context).
 * Attaching to a *different* task is refused with HTTP 409 — there is no
 * `--force` and no `session detach`; a different task requires a brand-new
 * Claude Code session.
 */
export async function sessionAttach(
  identifier: string | undefined
): Promise<number | void> {
  if (!identifier) {
    console.error(
      'Error: missing <identifier>. Usage: lumo session attach <LUM-42>'
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
  // Lifetime lock (LUM-459): the session is permanently bound to another task.
  if (res.status === 409) {
    let current = 'another task'
    try {
      const data = (await res.json()) as {
        currentTaskIdentifier?: string
        currentTaskTitle?: string
      }
      if (data.currentTaskIdentifier) {
        current = data.currentTaskTitle
          ? `${data.currentTaskIdentifier} "${sanitizeField(data.currentTaskTitle)}"`
          : data.currentTaskIdentifier
      }
    } catch {
      // fall through with the generic phrasing
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

  console.log(
    `Attached session ${sessionId} to ${body.taskIdentifier} "${sanitizeField(body.taskTitle)}"`
  )
  console.log(
    `Re-tagged ${body.retaggedEventCount} previously-untagged event${
      body.retaggedEventCount === 1 ? '' : 's'
    } in this session.`
  )
  // Warnings come before contract/memory: matches the hook injection order —
  // short, actionable information first.
  if (body.blockerWarningSection) {
    console.log('')
    console.log(sanitizeField(body.blockerWarningSection))
  }
  // Contract next: it's what the upcoming work is judged against (LUM-342).
  if (body.criteriaSection) {
    console.log('')
    console.log(sanitizeField(body.criteriaSection))
  }
  if (body.memorySection !== '') {
    console.log('')
    console.log(sanitizeField(body.memorySection))
  }

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
}
