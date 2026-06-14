import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { openBrowser } from '../lib/browser'

/**
 * Rejection-reason vocabulary (mirrors the server's VerificationRejectionReason
 * enum). Required on the agent --fail path — the agent pays the structured tax
 * a human is spared (LUM-422 ①).
 */
const FAIL_REASONS = [
  'CRITERION_UNMET',
  'EVIDENCE_INSUFFICIENT',
  'CHECK_EXECUTION_ERROR',
  'SCOPE_MISMATCH',
  'OTHER',
] as const
type FailReason = (typeof FAIL_REASONS)[number]

export interface VerdictOptions {
  pass?: boolean
  fail?: boolean
  reason?: string
  note?: string
  /** Repeatable --criterion <id>; narrows a --fail send-back to those criteria. */
  criterion?: string[]
}

/** Collect repeatable `--criterion <id>` flags into an array (commander idiom). */
export function collectCriterion(value: string, prev: string[] = []): string[] {
  return [...prev, value]
}

interface AgentVerdictOutcome {
  round: number
  verdict: 'FAIL'
  taskStatus: string
  criterionIds: string[]
  commentId: string | null
}

/**
 * `lumo verdict [task]` — human + agent acceptance verdicts (LUM-422).
 *
 * Two modes, exactly one required:
 *   --pass  opens the browser to the task's verdict bar, focused on Pass (a deep
 *       link — writes NOTHING; a passing data row is only ever produced by a
 *       human's own click, red line).
 *   --fail --reason <enum> [--note] [--criterion …]  records an AGENT send-back
 *       (verdict hard-coded FAIL server-side) and bounces the task to
 *       IN_PROGRESS. Bearer-authed.
 *
 * Defaults to the session-bound task; an explicit identifier overrides.
 */
export async function verdict(
  identifier: string | undefined,
  options: VerdictOptions = {}
): Promise<number | void> {
  const modes = [options.pass && 'pass', options.fail && 'fail'].filter(Boolean)
  if (modes.length === 0) {
    console.error('Error: choose a verdict mode — --pass or --fail.')
    return 1
  }
  if (modes.length > 1) {
    console.error(
      `Error: pick exactly one verdict mode (got ${modes.join(', ')}).`
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  // ── Resolve the task: explicit identifier or the session binding ──────────
  let taskId = identifier
  if (!taskId) {
    if (!sessionId) {
      console.error(
        'Error: no task given and $CLAUDE_CODE_SESSION_ID is not set.\n' +
          'Run `lumo verdict <LUM-N> …` or run inside a session bound via `lumo session attach`.'
      )
      return 1
    }
    let res: Response
    try {
      res = await fetch(
        `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
        { headers }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API (${msg})`)
      return 1
    }
    const data = res.ok
      ? ((await res.json()) as { taskIdentifier: string | null })
      : null
    if (!data?.taskIdentifier) {
      console.error(
        'Error: this session is not bound to a task. Run `lumo session attach <LUM-N>` first, or pass the task explicitly.'
      )
      return 1
    }
    taskId = data.taskIdentifier
  }

  if (options.fail) {
    return failVerdict(base, headers, taskId, options, creds.workspaceSlug)
  }
  return passDeepLink(base, headers, taskId, creds.workspaceSlug)
}

/**
 * --pass: open the human's verdict bar pre-focused on Pass. The CLI never writes
 * the verdict — it only carries the human to the one click that does (red line:
 * no agent-produced passing row).
 */
async function passDeepLink(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  workspaceSlug: string
): Promise<number | void> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/by-identifier/${encodeURIComponent(taskId)}`,
      { headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${taskId} not found in workspace ${workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: could not load task (HTTP ${res.status})`)
    return 1
  }
  const { task } = (await res.json()) as { task: { url?: string } }
  if (!task?.url) {
    console.error('Error: server did not return a task URL to open.')
    return 1
  }
  const sep = task.url.includes('?') ? '&' : '?'
  const deepLink = `${task.url}${sep}verdict=pass`

  const label = 'Pass'
  process.stdout.write(
    `Opening ${taskId} for a human "${label}" verdict (nothing is recorded until they click):\n` +
      `  ${sanitizeField(deepLink)}\n`
  )
  openBrowser(deepLink)
  return
}

/**
 * --fail: record an AGENT send-back. The server hard-codes verdict=FAIL and
 * verifierType=AGENT — there is no passing verdict the CLI can express.
 */
async function failVerdict(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  options: VerdictOptions,
  workspaceSlug: string
): Promise<number | void> {
  if (!options.reason) {
    console.error(
      `Error: --fail requires --reason <${FAIL_REASONS.join('|')}>.`
    )
    return 1
  }
  // Case-insensitive like every other CLI enum flag (LUM-420): fold to the
  // canonical upper-case enum before validating and sending.
  const reason = options.reason.toUpperCase()
  if (!FAIL_REASONS.includes(reason as FailReason)) {
    console.error(
      `Error: invalid --reason "${options.reason}". Allowed: ${FAIL_REASONS.join(', ')}.`
    )
    return 1
  }

  const body: {
    rejectionReasonEnum: FailReason
    note?: string
    criterionIds?: string[]
  } = { rejectionReasonEnum: reason as FailReason }
  if (options.note) body.note = options.note
  if (options.criterion && options.criterion.length > 0) {
    body.criterionIds = options.criterion
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/agent-verdict`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${taskId} not found in workspace ${workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? sanitizeField(errBody.error)
        : ''
    console.error(
      `Error: send-back rejected (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }

  const outcome = (await res.json()) as AgentVerdictOutcome
  process.stdout.write(
    `✗ Sent ${taskId} back (AGENT FAIL, reason ${reason}) — ` +
      `${outcome.criterionIds.length} ${
        outcome.criterionIds.length === 1 ? 'criterion' : 'criteria'
      } at round ${outcome.round}; task is now ${outcome.taskStatus}.\n`
  )
  if (outcome.commentId) {
    process.stdout.write('  A send-back note was posted as a task comment.\n')
  }
  process.stdout.write(
    'Address the unmet criteria (see `lumo task status`), then re-verify.\n'
  )
  return
}
