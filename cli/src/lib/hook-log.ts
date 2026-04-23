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
 */
export function logHookError(message: string): void {
  try {
    const dir = logDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700, recursive: true })
    const line = `${new Date().toISOString()} ${message}\n`
    fs.appendFileSync(logPath(), line, { mode: 0o600 })
  } catch {
    // Log writes are best-effort; never throw
  }
}
