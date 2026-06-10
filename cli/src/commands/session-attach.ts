import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { promptLine } from '../lib/line-prompt'

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
}

/** The session is already bound to a different task; the server refused to
 *  overwrite without confirmation and returned the current binding. */
interface AlreadyBoundResponse {
  status: 'already-bound'
  currentTaskIdentifier: string
  currentTaskTitle: string
}

type BindResponse = BoundResponse | AlreadyBoundResponse

interface AttachOptions {
  /** Skip the override confirmation and overwrite an existing binding. */
  force?: boolean
}

type BindOutcome =
  | { ok: false; code: number }
  | { ok: true; body: BindResponse }

/**
 * `lumo session attach <identifier>` — bind the currently-running
 * Claude Code session to a task.
 *
 * Required environment: `CLAUDE_CODE_SESSION_ID` (set automatically by
 * Claude Code). Must be invoked from inside a Claude Code session — there
 * is no longer a global "current task" pointer for terminals outside CC.
 *
 * The binding lives entirely on the server (`Session.taskId`); subsequent
 * hooks read it back via the session row. The CLI keeps no local sentinel.
 *
 * Re-binding a session that's already attached to a *different* task no
 * longer silently clobbers `Session.taskId` (LUM-266): the server returns
 * the current binding and we confirm before overwriting —
 *   - `--force` skips the prompt and overwrites directly;
 *   - on a TTY we ask `已绑定 LUM-X，覆盖为 LUM-Y? [y/N]`;
 *   - off a TTY (the usual agent case) we refuse and point at `--force`.
 */
export async function sessionAttach(
  identifier: string | undefined,
  options: AttachOptions = {}
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

  const bind = async (force: boolean): Promise<BindOutcome> => {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
        },
        body: JSON.stringify({ taskIdentifier: identifier, force }),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
      return { ok: false, code: 1 }
    }

    if (res.status === 401) {
      console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
      return { ok: false, code: 1 }
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
      return { ok: false, code: 1 }
    }
    if (!res.ok) {
      console.error(`Error: bind-task failed (HTTP ${res.status})`)
      return { ok: false, code: 1 }
    }

    return { ok: true, body: (await res.json()) as BindResponse }
  }

  // First attempt. `--force` overwrites unconditionally; otherwise the server
  // may answer `already-bound` so we can confirm before clobbering.
  const first = await bind(options.force === true)
  if (!first.ok) return first.code
  let body = first.body

  if (body.status === 'already-bound') {
    // Reached only when not forced (force=true would have overwritten).
    if (!process.stdin.isTTY) {
      console.error(
        `Session already bound to ${body.currentTaskIdentifier} "${sanitizeField(body.currentTaskTitle)}". ` +
          `Not overwriting. Re-run with --force to switch to ${identifier} ` +
          '(or run `lumo session detach` first).'
      )
      return 0
    }

    const answer = await promptLine(
      `已绑定 ${body.currentTaskIdentifier}，覆盖为 ${identifier}? [y/N] `
    )
    if (!/^y(es)?$/i.test(answer)) {
      console.log(`已取消，仍绑定 ${body.currentTaskIdentifier}。`)
      return 0
    }

    const second = await bind(true)
    if (!second.ok) return second.code
    body = second.body
  }

  if (body.status === 'already-bound') {
    // Defensive: a forced bind should never report already-bound.
    console.error(
      `Error: bind did not take effect (still bound to ${body.currentTaskIdentifier}).`
    )
    return 1
  }

  console.log(
    `Attached session ${sessionId} to ${body.taskIdentifier} "${sanitizeField(body.taskTitle)}"`
  )
  console.log(
    `Re-tagged ${body.retaggedEventCount} previously-untagged event${
      body.retaggedEventCount === 1 ? '' : 's'
    } in this session.`
  )
  if (body.memorySection !== '') {
    console.log('')
    console.log(sanitizeField(body.memorySection))
  }
  if (body.blockerWarningSection && body.blockerWarningSection !== '') {
    console.log('')
    console.log(sanitizeField(body.blockerWarningSection))
  }
}
