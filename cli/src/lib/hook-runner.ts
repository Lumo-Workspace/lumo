import { readCredentials } from './config'
import { trimTrailingSlash } from './api'
import { readSessionBinding } from './session-binding'
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

function extractSessionId(body: string): string | null {
  if (!body) return null
  try {
    const parsed = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const sid = (parsed as Record<string, unknown>).session_id
      if (typeof sid === 'string' && sid.length > 0) return sid
    }
  } catch {
    // ignore — malformed body, treat as no session_id
  }
  return null
}

/**
 * Merge the per-session binding's `taskId` (if any) into the hook JSON body
 * as a top-level `task_id` field. Always returns a non-empty JSON string so
 * the POST body is valid even when stdin is empty or malformed.
 *
 * The lookup is keyed by `sessionId` (parsed from the hook payload by the
 * caller) — there is no global sentinel any more, so parallel Claude Code
 * sessions cannot pollute each other.
 *
 * No injection happens when:
 *   - `hookType === 'session-start'` (the session row may not even exist
 *     server-side yet; binding is set later by `lumo session attach`)
 *   - `sessionId` is null (hook payload had no session_id)
 *   - no per-session binding file exists
 *   - the parsed body isn't a JSON object
 *
 * Failures always degrade silently — we never block Claude Code for hook
 * enrichment.
 */
export function injectTaskId(
  body: string,
  hookType: HookPath,
  sessionId: string | null
): string {
  if (hookType === 'session-start' || !sessionId) {
    return body || '{}'
  }
  const binding = readSessionBinding(sessionId)
  if (!binding) return body || '{}'
  if (!body) return JSON.stringify({ task_id: binding.taskId })
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return body
  }
  return JSON.stringify({
    ...(parsed as Record<string, unknown>),
    task_id: binding.taskId,
  })
}

/**
 * Format the session-start response body into a human/Claude-readable string
 * that gets written to stdout so Claude Code injects it into conversation
 * context.
 *
 * Returns null when the body is missing required fields or not an object —
 * callers should treat null as "nothing to print".
 */
export function formatSessionStartOutput(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const sessionId = b.sessionId
  const binding = b.taskBinding
  if (typeof sessionId !== 'string' || !binding || typeof binding !== 'object')
    return null
  const tb = binding as Record<string, unknown>
  if (tb.bound === true) {
    return `[Lumo] session_id=${sessionId} | 当前任务: ${tb.taskIdentifier} - ${tb.taskTitle}`
  }
  if (tb.bound === false) {
    return `[Lumo] session_id=${sessionId} | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。`
  }
  return null
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

    const sessionId = extractSessionId(body)
    const enriched = injectTaskId(body, path, sessionId)
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
        body: enriched,
        signal: controller.signal,
      })
      if (!res.ok) {
        logHookError(`[${path}]`, `HTTP ${res.status} from ${url}`)
      } else if (path === 'session-start') {
        try {
          const responseBody = await res.json()
          const output = formatSessionStartOutput(responseBody)
          if (output) process.stdout.write(output + '\n')
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
