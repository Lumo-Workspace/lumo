import { readCredentials } from './config'
import { trimTrailingSlash } from './api'
import { logHookError } from './hook-log'

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
 * body. Returns an empty array for any path other than 'session-start'.
 *
 * For 'session-start' the array contains:
 *   [0] plain-text bind/unbound status line (always present when taskBinding exists)
 *   [1] (optional) hookSpecificOutput JSON when memorySection is a non-empty string
 *
 * The JSON on line [1] conforms to Claude Code's hookSpecificOutput envelope so
 * the runtime injects additionalContext into the conversation automatically.
 */
export function formatHookStdoutLines(
  path: string,
  responseBody: unknown
): string[] {
  if (path !== 'session-start') return []
  if (responseBody == null || typeof responseBody !== 'object') return []
  const body = responseBody as {
    sessionId?: string
    taskBinding?: { bound: boolean; taskIdentifier?: string; taskTitle?: string }
    memorySection?: string
  }
  if (!body.sessionId) return []
  const lines: string[] = []
  const sessionId = body.sessionId
  const tb = body.taskBinding
  if (tb && tb.bound === true) {
    lines.push(
      `[Lumo] session_id=${sessionId} | 当前任务: ${tb.taskIdentifier} - ${tb.taskTitle}`
    )
  } else if (tb && tb.bound === false) {
    lines.push(
      `[Lumo] session_id=${sessionId} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。`
    )
  }
  if (typeof body.memorySection === 'string' && body.memorySection !== '') {
    lines.push(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: body.memorySection,
        },
      })
    )
  }
  return lines
}

/**
 * POST the hook body to /api/hooks/<path> with a short timeout. All errors
 * — credential missing, network failure, timeout, non-2xx — are routed to
 * hook.log and then the caller exits 0.
 *
 * This function NEVER throws and NEVER rejects.
 */
export async function runHook(path: HookPath): Promise<void> {
  const body = await readStdin()
  return runHookWithBody(path, body)
}

/**
 * Test-friendly worker. Takes the hook body as an argument so tests can
 * exercise the side-effect logic without poking process.stdin. Production
 * code always goes through `runHook`, which feeds it real stdin.
 */
export async function runHookWithBody(
  path: HookPath,
  body: string
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
    const envUrl = process.env.LUMO_API_URL?.trim()
    const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
    const url = `${trimTrailingSlash(apiUrl)}/api/hooks/${path}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
        },
        body: body || '{}',
        signal: controller.signal,
      })
      if (!res.ok) {
        logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
      } else if (path === 'session-start') {
        // Per-hook side effects fire only after a 2xx response so a transient
        // server failure doesn't desync local state from server state.
        try {
          const responseBody = await res.json()
          for (const line of formatHookStdoutLines(path, responseBody)) {
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
