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
