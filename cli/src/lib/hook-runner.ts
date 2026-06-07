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
      `[Lumo] session_id=${sessionId} | 当前任务: ${tb.taskIdentifier} - ${sanitizeField(tb.taskTitle ?? '')}`
    )
  } else if (tb && tb.bound === false) {
    lines.push(unboundPromptLine(sessionId))
  }
  // Recovery card + memory + linked resources + PR-review todos share one
  // additionalContext block so Claude Code injects a single coherent context
  // payload at session start. The card slots in first so it's the first thing
  // the model reads.
  const card = renderRecoveryCard(
    body.previousSession,
    tb?.taskIdentifier ?? '',
    now
  )
  const envelope = sessionContextEnvelope([
    card,
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
  memorySection?: string
  linkedResourcesSection?: string
  reviewTodosSection?: string
  layer2ReviewSection?: string
  previousSession?: PreviousSessionCard | null
}

/**
 * The plain-text line shown when a session starts without a bound task and
 * no task could be inferred from local git — the user is asked to name one.
 */
function unboundPromptLine(sessionId: string): string {
  return `[Lumo] session_id=${sessionId} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。`
}

const MAX_UNRESOLVED = 5

/**
 * Render the "续上次进度" recovery card from the structured previousSession
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
    `## 续上次进度 (上一段 session · ${ago} · ${dur})`,
    `上次干到：${sanitizeField(prev.headline)}`,
  ]
  const unresolved = Array.isArray(prev.unresolved) ? prev.unresolved : []
  if (unresolved.length > 0) {
    lines.push('未完成：')
    const shown = unresolved.slice(0, MAX_UNRESOLVED)
    for (const u of shown) lines.push(`- ${sanitizeField(u)}`)
    const extra = unresolved.length - shown.length
    if (extra > 0) {
      lines.push(
        `- …(+${extra} more, 跑 lumo task context ${taskIdentifier} 查看全部)`
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
 * Result of an attempt to bind a session to an inferred task. `ok: false`
 * covers every failure (task not found, network error, timeout) and routes
 * the caller back to the unbound prompt.
 */
export interface AutoBindAttempt {
  ok: boolean
  taskIdentifier?: string | undefined
  taskTitle?: string | undefined
  memorySection?: string | undefined
  previousSession?: PreviousSessionCard | null | undefined
}

/**
 * Dependencies for `resolveSessionStartStdout`, injected so the orchestration
 * can be unit-tested without touching git or the network.
 */
export interface AutoBindDeps {
  extractTask: () => GitTaskMatch | null
  bindTask: (sessionId: string, identifier: string) => Promise<AutoBindAttempt>
}

/**
 * The single status line printed after a successful auto-bind. Explains which
 * git signal (branch name vs recent commit) it relied on and how to undo it.
 */
export function formatAutoBindLine(
  sessionId: string,
  match: GitTaskMatch,
  result: AutoBindAttempt
): string {
  const basis = match.source === 'branch' ? '分支名' : '最近 commit'
  const identifier = result.taskIdentifier ?? match.identifier
  return `[Lumo] session_id=${sessionId} | 已自动绑定 ${identifier} - ${sanitizeField(
    result.taskTitle ?? ''
  )}（依据${basis}）。如果不对，回复"不是"我就帮你解绑。`
}

/**
 * Build the stdout lines for a session-start response, including the LUM-145
 * auto-bind behavior: when the server reports no binding, infer the task from
 * local git and bind it; on a hit, print the auto-bind line (plus the freshly
 * bound task's memory). Falls back to the unbound prompt when nothing matches
 * or the bind fails. Bound sessions reuse the existing formatting.
 */
export async function resolveSessionStartStdout(
  responseBody: unknown,
  deps: AutoBindDeps,
  now: Date = new Date()
): Promise<string[]> {
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

  const result = await deps.bindTask(sessionId, match.identifier)
  if (!result.ok) return [unboundPromptLine(sessionId)]

  const lines = [formatAutoBindLine(sessionId, match, result)]
  const card = renderRecoveryCard(
    result.previousSession,
    result.taskIdentifier ?? match.identifier,
    now
  )
  // bind-task only returns memory + previousSession (not reviewTodosSection) —
  // the auto-bind endpoint never built PR-review todos. Keep that scope here;
  // surfacing review todos on the auto-bind path is a separate change.
  const envelope = sessionContextEnvelope([card, result.memorySection])
  if (envelope) lines.push(envelope)
  return lines
}

/**
 * POST the inferred task binding to the same `bind-task` endpoint that
 * `lumo session attach` uses. Guarded by the same short timeout as the hook
 * POST so the extra round trip can never make session-start hang. Any
 * failure (404 unknown task, network, timeout, non-2xx) returns
 * `{ ok: false }`, which routes the caller back to the unbound prompt.
 */
async function postBindTask(
  sessionId: string,
  identifier: string,
  token: string,
  apiUrl: string
): Promise<AutoBindAttempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = `${trimTrailingSlash(apiUrl)}/api/sessions/${encodeURIComponent(
      sessionId
    )}/bind-task`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ taskIdentifier: identifier }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false }
    const body = (await res.json()) as {
      taskIdentifier?: string
      taskTitle?: string
      memorySection?: string
      previousSession?: PreviousSessionCard | null
    }
    return {
      ok: true,
      taskIdentifier: body.taskIdentifier,
      taskTitle: body.taskTitle,
      memorySection: body.memorySection,
      previousSession: body.previousSession ?? undefined,
    }
  } catch (err) {
    logHookError('[session-start] auto-bind', err)
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * For stop/stop-failure hooks, read the transcript named in the payload and
 * fold cumulative token totals into the body under `_lumo_usage` so the server
 * can persist them on the Session. Best-effort: returns the body unchanged on
 * any failure (no transcript_path, unreadable, unparseable, no usage). The
 * hook is never blocked or failed by this.
 */
export function augmentBodyWithUsage(path: HookPath, body: string): string {
  if (path !== 'stop' && path !== 'stop-failure') return body
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
  return JSON.stringify({ ...parsed, _lumo_usage: usage })
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
        //   session-start → bind status + injected context (incl. LUM-145
        //                   auto-bind from local git when unbound)
        //   pre-tool-use  → parallel-edit collision warning (LUM-150 ③)
        // Only after a 2xx so a transient server failure emits nothing.
        try {
          const responseBody = await res.json()
          const lines =
            path === 'session-start'
              ? await resolveSessionStartStdout(responseBody, {
                  extractTask: () => extractTaskFromGit(),
                  bindTask: (sessionId, identifier) =>
                    postBindTask(sessionId, identifier, creds.token, apiUrl),
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
