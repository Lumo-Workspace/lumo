import { readCredentials } from './config'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { logHookError } from './hook-log'
import { sanitizeField } from './sanitize'
import { normalizeAgent } from './agent'
import { extractTaskFromGit, type GitTaskMatch } from './git-task'
import { formatDuration, relativeTime } from './format'
import { sumTranscriptUsage } from './transcript-usage'

/**
 * Hard timeout for the hook POST. On timeout the request is aborted,
 * logged, and `runHook` exits 0 — Claude Code is never blocked beyond
 * this ceiling.
 *
 * Sizing history:
 *   - 1000ms (initial): too tight, false timeouts on cold starts
 *   - 1500ms (per plan): still below observed p95 for cold
 *     Next.js + Prisma + Clerk on dev; server actually inserts the row
 *     but the client aborts before reading the 200, so `hook.log` fills
 *     with "This operation was aborted" noise
 *   - 3000ms (now): matches observed p95 on dev; catches the full
 *     happy path without being long enough to make users feel per-tool
 *     hook lag. Revisit when Day 4 makes hook POSTs fire-and-forget so
 *     the client can exit 0 before the server finishes.
 */
const TIMEOUT_MS = 3000

export type HookPath =
  | 'user-prompt-submit'
  | 'pre-tool-use'
  | 'post-tool-use'
  | 'post-tool-use-failure'
  | 'stop'
  | 'stop-failure'
  | 'permission-request'
  | 'permission-denied'
  | 'session-start'
  | 'session-end'
  | 'subagent-start'
  | 'subagent-stop'
  | 'worktree-create'
  | 'worktree-remove'
  | 'file-changed'
  | 'config-change'
  | 'task-created'
  | 'task-completed'
  | 'post-tool-batch'
  | 'user-prompt-expansion'
  | 'notification'
  | 'elicitation'
  | 'elicitation-result'
  | 'cwd-changed'
  | 'instructions-loaded'

/**
 * Read the full hook JSON from stdin.
 *
 * Resolves to an empty string on EOF if no bytes were produced (e.g. tests
 * or a client that invoked the command with no stdin attached). This lets
 * the runner POST `{}` rather than hanging.
 */
function readStdin(): Promise<string> {
  return new Promise(resolve => {
    // If stdin is a TTY (nothing piped in), resolve immediately so the hook
    // doesn't hang when invoked outside of Claude Code.
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

/**
 * Build the array of stdout lines to emit for a given hook path + response
 * body. Returns an empty array for any path that emits nothing.
 *
 * For 'session-start' the array contains:
 *   [0] plain-text bind/unbound status line (always present when taskBinding exists)
 *   [1] (optional) hookSpecificOutput JSON when there is any additionalContext —
 *       the memory section and the PR-review-todos section, concatenated.
 *
 * For 'pre-tool-use' the array contains:
 *   [0] (optional) a PreToolUse hookSpecificOutput JSON carrying the parallel-
 *       edit collision warning as additionalContext, when the server returned a
 *       `collisionWarning` (LUM-150 step ③). Empty otherwise.
 *
 * The JSON lines conform to Claude Code's hookSpecificOutput envelope so the
 * runtime injects additionalContext into the conversation automatically.
 */
export function formatHookStdoutLines(
  path: string,
  responseBody: unknown,
  now: Date = new Date()
): string[] {
  if (path === 'pre-tool-use') {
    if (responseBody == null || typeof responseBody !== 'object') return []
    const warning = (responseBody as { collisionWarning?: unknown })
      .collisionWarning
    if (typeof warning !== 'string' || warning === '') return []
    return [
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          // Server-built text routed back to stdout — sanitize untrusted free
          // text before Claude Code consumes it (ANSI/control-char injection).
          additionalContext: sanitizeField(warning),
        },
      }),
    ]
  }
  if (path !== 'session-start') return []
  if (responseBody == null || typeof responseBody !== 'object') return []
  const body = responseBody as SessionStartBody
  if (!body.sessionId) return []
  const lines: string[] = []
  const sessionId = body.sessionId
  const tb = body.taskBinding
  if (tb && tb.bound === true) {
    lines.push(
      `[Lumo] session_id=${sessionId} | Current task: ${tb.taskIdentifier} - ${sanitizeField(tb.taskTitle ?? '')}`
    )
  } else if (tb && tb.bound === false) {
    lines.push(unboundPromptLine(sessionId))
  }
  // Recovery card + blocker warning + memory + linked resources + PR-review
  // todos share one additionalContext block so Claude Code injects a single
  // coherent context payload at session start. The card slots in first so it's
  // the first thing the model reads; the dependency blocker warning (LUM-172)
  // comes right after so it stays prominent, ahead of the memory section.
  const card = renderRecoveryCard(
    body.previousSession,
    tb?.taskIdentifier ?? '',
    now
  )
  const envelope = sessionContextEnvelope([
    card,
    // Blocker warning right after the card: it can preempt the session's
    // work entirely (wait for the blocker instead of starting) — LUM-172.
    body.blockerWarningSection,
    // Acceptance contract next: it's what the session's work is judged
    // against (LUM-342).
    body.criteriaSection,
    body.memorySection,
    body.linkedResourcesSection,
    body.reviewTodosSection,
    body.layer2ReviewSection,
  ])
  if (envelope) lines.push(envelope)
  return lines
}

type PreviousSessionCard = {
  headline: string
  unresolved: string[]
  durationMs: number
  lastActivityAt: string
}

type SessionStartBody = {
  sessionId?: string
  taskBinding?: {
    bound: boolean
    taskIdentifier?: string
    taskTitle?: string
  }
  criteriaSection?: string
  memorySection?: string
  linkedResourcesSection?: string
  reviewTodosSection?: string
  layer2ReviewSection?: string
  blockerWarningSection?: string
  previousSession?: PreviousSessionCard | null
}

/**
 * The plain-text line shown when a session starts without a bound task and
 * no task could be inferred from local git — the user is asked to name one.
 */
function unboundPromptLine(sessionId: string): string {
  return `[Lumo] session_id=${sessionId} | No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".`
}

const MAX_UNRESOLVED = 5

/**
 * Render the "resuming previous session" recovery card from the structured previousSession
 * payload. Returns undefined when there's nothing to show (null payload or an
 * empty headline). Free text (headline / unresolved) is sanitized here — it's
 * LLM-generated and routed to Claude Code stdout. unresolved is capped at
 * MAX_UNRESOLVED with a "+M more" pointer to `lumo task context`.
 */
function renderRecoveryCard(
  prev: PreviousSessionCard | null | undefined,
  taskIdentifier: string,
  now: Date
): string | undefined {
  if (!prev || typeof prev.headline !== 'string' || prev.headline === '') {
    return undefined
  }
  const ago = relativeTime(new Date(prev.lastActivityAt), now)
  const dur = formatDuration(prev.durationMs)
  const lines: string[] = [
    `## Resuming previous session (${ago} · ${dur})`,
    `Last stopped at: ${sanitizeField(prev.headline)}`,
  ]
  const unresolved = Array.isArray(prev.unresolved) ? prev.unresolved : []
  if (unresolved.length > 0) {
    lines.push('Unfinished:')
    const shown = unresolved.slice(0, MAX_UNRESOLVED)
    for (const u of shown) lines.push(`- ${sanitizeField(u)}`)
    const extra = unresolved.length - shown.length
    if (extra > 0) {
      lines.push(
        `- … (+${extra} more — run \`lumo task context ${taskIdentifier}\` for the full list)`
      )
    }
  }
  return lines.join('\n')
}

/**
 * Wrap any non-empty context parts into a single SessionStart
 * hookSpecificOutput envelope so Claude Code injects one coherent
 * additionalContext payload. Returns null when there is nothing to inject.
 */
function sessionContextEnvelope(
  parts: Array<string | undefined>
): string | null {
  const filled = parts.filter(
    (s): s is string => typeof s === 'string' && s !== ''
  )
  if (filled.length === 0) return null
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: filled.join('\n\n'),
    },
  })
}

/**
 * Dependencies for `resolveSessionStartStdout`, injected so the orchestration
 * can be unit-tested without touching git. The only signal we need is the
 * task inferred from local git; binding is no longer done automatically
 * (LUM-302 — detect-and-suggest, never auto-bind).
 */
export interface SessionStartDeps {
  extractTask: () => GitTaskMatch | null
}

/**
 * The single line printed when a task is inferred from local git at session
 * start. We deliberately do NOT bind — we point the user at the explicit
 * `lumo session attach` so binding stays a confirmed, manual action. The basis
 * (branch name vs recent commit) is shown so the inference is auditable. No
 * task title is available here because nothing was fetched; the title and
 * context surface only once the user actually attaches.
 */
export function formatSuggestLine(
  sessionId: string,
  match: GitTaskMatch
): string {
  const basis = match.source === 'branch' ? 'branch name' : 'recent commits'
  return `[Lumo] session_id=${sessionId} | Detected ${match.identifier} (from ${basis}). Run \`lumo session attach ${match.identifier}\` to bind.`
}

/**
 * Build the stdout lines for a session-start response. When the server reports
 * the session is already bound, reuse the bound formatting (status line +
 * injected context). When it's unbound, infer the task from local git and — on
 * a hit — print a one-line *suggestion* to run `lumo session attach` (LUM-302:
 * detect-and-suggest, never auto-bind). No match falls back to the generic
 * unbound prompt.
 */
export function resolveSessionStartStdout(
  responseBody: unknown,
  deps: SessionStartDeps,
  now: Date = new Date()
): string[] {
  if (responseBody == null || typeof responseBody !== 'object') return []
  const body = responseBody as SessionStartBody
  if (!body.sessionId) return []
  const sessionId = body.sessionId
  const tb = body.taskBinding

  if (tb && tb.bound === true) {
    return formatHookStdoutLines('session-start', responseBody, now)
  }
  if (!tb || tb.bound !== false) return []

  const match = deps.extractTask()
  if (!match) return [unboundPromptLine(sessionId)]
  return [formatSuggestLine(sessionId, match)]
}

/**
 * For stop/stop-failure/post-tool-batch hooks, read the transcript named in
 * the payload and fold cumulative token totals into the body under
 * `_lumo_usage` so the server can persist them on the Session. post-tool-batch
 * carries usage so long single turns surface live burn before the first STOP
 * (LUM-345); the server treats it as a flat-columns-only overwrite. Best-
 * effort: returns the body unchanged on any failure (no transcript_path,
 * unreadable, unparseable, no usage). The hook is never blocked or failed by
 * this.
 */
export function augmentBodyWithUsage(path: HookPath, body: string): string {
  if (path !== 'stop' && path !== 'stop-failure' && path !== 'post-tool-batch')
    return body
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body || '{}')
  } catch {
    return body
  }
  const transcriptPath = parsed['transcript_path']
  if (typeof transcriptPath !== 'string' || !transcriptPath) return body
  const usage = sumTranscriptUsage(transcriptPath)
  if (!usage) return body
  return JSON.stringify({
    ...parsed,
    _lumo_usage: { ...usage.total, byModel: usage.byModel },
  })
}

/**
 * POST the hook body to /api/hooks/<path> with a short timeout. All errors
 * — credential missing, network failure, timeout, non-2xx — are routed to
 * hook.log and then the caller exits 0.
 *
 * This function NEVER throws and NEVER rejects.
 */
export async function runHook(
  path: HookPath,
  agentToken?: string
): Promise<void> {
  const body = await readStdin()
  return runHookWithBody(path, body, agentToken)
}

/**
 * Test-friendly worker. Takes the hook body as an argument so tests can
 * exercise the side-effect logic without poking process.stdin. Production
 * code always goes through `runHook`, which feeds it real stdin.
 */
export async function runHookWithBody(
  path: HookPath,
  body: string,
  agentToken?: string
): Promise<void> {
  try {
    const creds = readCredentials()
    if (!creds) {
      logHookError(`[${path}]`, 'no credentials; skipping')
      return
    }

    // Allow `LUMO_API_URL` to override the baked-in creds.apiUrl for
    // redirecting hooks at dev-env switch without re-running `lumo auth
    // login`. The bearer token from creds.json is still used as-is.
    // An insecure override (non-https, non-localhost) throws here and is
    // caught by the outer try/catch → logged, POST skipped, hook still exits 0.
    // The host-mismatch warning goes to hook.log (never stdout, which would
    // pollute Claude Code).
    const apiUrl = resolveAuthedApiUrl(creds.apiUrl, {
      warn: message => logHookError(`[${path}]`, message),
    })
    const url = `${trimTrailingSlash(apiUrl)}/api/hooks/${path}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Tell the server which coding agent produced this hook. The token is
    // baked into the hook command at `lumo setup --agent <token>`; we send
    // the normalized enum so the server can record it on the session. An
    // unrecognized/absent token is dropped — the server then falls back to
    // its default (CLAUDE_CODE).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.token}`,
    }
    const agentEnum = agentToken ? normalizeAgent(agentToken) : null
    if (agentEnum) headers['X-Lumo-Agent'] = agentEnum

    const outgoingBody = augmentBodyWithUsage(path, body) || '{}'

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: outgoingBody,
        signal: controller.signal,
      })
      if (!res.ok) {
        logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
      } else if (path === 'session-start' || path === 'pre-tool-use') {
        // Paths that turn the response body into stdout for Claude Code:
        //   session-start → bind status + injected context, or (when unbound)
        //                   a LUM-302 suggest line inferred from local git
        //   pre-tool-use  → parallel-edit collision warning (LUM-150 ③)
        // Only after a 2xx so a transient server failure emits nothing.
        try {
          const responseBody = await res.json()
          const lines =
            path === 'session-start'
              ? resolveSessionStartStdout(responseBody, {
                  extractTask: () => extractTaskFromGit(),
                })
              : formatHookStdoutLines(path, responseBody)
          for (const line of lines) {
            process.stdout.write(line + '\n')
          }
        } catch {
          // response body parse failure is non-fatal
        }
      }
    } catch (err) {
      logHookError(`[${path}]`, err)
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    logHookError(`[${path}] runner`, err)
  }
}
