import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function logDir(): string {
  return path.join(os.homedir(), '.lumo')
}

function logPath(): string {
  return path.join(logDir(), 'hook.log')
}

/**
 * Best-effort append to `~/.lumo/hook.log`.
 *
 * Hook commands must never emit to stderr (that would pollute Claude Code's
 * terminal output). All errors — network, auth, timeout, filesystem — are
 * appended here instead. If the log write itself fails, we swallow that too:
 * a broken log is better than a broken hook.
 *
 * @param context Short label identifying the call site (e.g. `"[pre-tool-use]"`)
 * @param error   Either an `Error`, a string, or anything else; stringified internally
 */
export function logHookError(context: string, error: unknown): void {
  try {
    const dir = logDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700, recursive: true })
    const msg = error instanceof Error ? error.message : String(error)
    const line = `${new Date().toISOString()} ${context} ${msg}\n`
    const p = logPath()
    const existed = fs.existsSync(p)
    fs.appendFileSync(p, line, { mode: 0o600 })
    // Best-effort permission tightening: appendFileSync's mode is only honored
    // on initial create, so chmod existing files to match config.ts style.
    if (existed) {
      try {
        fs.chmodSync(p, 0o600)
      } catch {
        // Best-effort
      }
    }
  } catch {
    // Log writes are best-effort; never throw
  }
}
