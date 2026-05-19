import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface SessionBinding {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  workspaceSlug: string
  startedAt: string
}

function configDir(): string {
  return process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
}

export function sessionBindingDir(): string {
  return path.join(configDir(), 'sessions')
}

export function sessionBindingPath(sessionId: string): string {
  return path.join(sessionBindingDir(), `${sessionId}.json`)
}

export function readSessionBinding(sessionId: string): SessionBinding | null {
  const p = sessionBindingPath(sessionId)
  if (!fs.existsSync(p)) return null
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (
      typeof data?.taskId !== 'string' ||
      typeof data?.taskIdentifier !== 'string' ||
      typeof data?.taskTitle !== 'string' ||
      typeof data?.workspaceSlug !== 'string' ||
      typeof data?.startedAt !== 'string'
    ) {
      return null
    }
    return data as SessionBinding
  } catch {
    return null
  }
}

export function writeSessionBinding(
  sessionId: string,
  binding: SessionBinding
): void {
  const dir = sessionBindingDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  }
  fs.writeFileSync(
    sessionBindingPath(sessionId),
    JSON.stringify(binding, null, 2),
    { mode: 0o600 }
  )
}

export function clearSessionBinding(sessionId: string): boolean {
  const p = sessionBindingPath(sessionId)
  if (!fs.existsSync(p)) return false
  fs.unlinkSync(p)
  return true
}

/**
 * Delete per-session binding files whose mtime is older than `olderThanDays`.
 * Only touches files ending in `.json` — any other content in the directory
 * is ignored. Single-file unlink failures are logged via console.error and
 * skipped (the loop continues), so a permission glitch on one file never
 * blocks cleanup of the rest. Returns the number of files actually removed.
 */
export function cleanupStaleBindings(olderThanDays: number): number {
  const dir = sessionBindingDir()
  if (!fs.existsSync(dir)) return 0
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  let removed = 0
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue
    const p = path.join(dir, entry)
    try {
      const stat = fs.statSync(p)
      if (stat.mtimeMs >= cutoffMs) continue
      fs.unlinkSync(p)
      removed++
    } catch (err) {
      console.error(`[session-binding] cleanup skipped ${entry}: ${err}`)
    }
  }
  return removed
}
