import { readCredentials } from './config'
import { trimTrailingSlash } from './api'
import { readCurrentTask } from './current-task'
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
 * Merge the current-task sentinel (if any) into the hook JSON body as a
 * top-level `task_id` field (internal Task.id, not identifier — see
 * `current-task.ts`). Always returns a non-empty JSON string so the POST
 * body is valid even when stdin is empty or malformed.
 *
 * Failure modes degrade silently — we never block Claude Code for hook
 * enrichment:
 *   - no current-task file    → return body as-is
 *   - malformed stdin JSON    → return body as-is (server falls back to its
 *                               own "invalid JSON" handling if so)
 *   - stdin body is a non-object → can't inject; return as-is
 */
export function injectCurrentTaskId(body: string): string {
  const current = readCurrentTask()
  if (!current) return body || '{}'
  if (!body) return JSON.stringify({ task_id: current.taskId })
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
    task_id: current.taskId,
  })
}

/**
 * POST the hook body to /api/hooks/<path> with a short timeout. All errors
 * — credential missing, network failure, timeout, non-2xx — are routed to
 * hook.log and then the caller exits 0.
 *
 * This function NEVER throws and NEVER rejects.
 */
export async function runHook(path: HookPath): Promise<void> {
  try {
    const creds = readCredentials()
    if (!creds) {
      logHookError(`[${path}]`, 'no credentials; skipping')
      return
    }

    const body = await readStdin()
    const enriched = injectCurrentTaskId(body)
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
