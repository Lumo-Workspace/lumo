import { readCredentials } from './config'
import { trimTrailingSlash } from './api'
import { logHookError } from './hook-log'

const TIMEOUT_MS = 1000

type HookPath = 'pre-tool-use' | 'post-tool-use' | 'stop'

/**
 * Read the full hook JSON from stdin.
 *
 * Resolves to an empty string on EOF if no bytes were produced (e.g. tests
 * or a client that invoked the command with no stdin attached). This lets
 * the runner POST `{}` rather than hanging.
 */
function readStdin(): Promise<string> {
  return new Promise(resolve => {
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
      logHookError(`[${path}] no credentials; skipping`)
      return
    }

    const body = await readStdin()
    const url = `${trimTrailingSlash(creds.apiUrl)}/api/hooks/${path}`

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
        logHookError(`[${path}] HTTP ${res.status} from ${url}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logHookError(`[${path}] request failed: ${msg}`)
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logHookError(`[${path}] runner error: ${msg}`)
  }
}
