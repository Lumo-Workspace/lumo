import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface CurrentTask {
  taskId: string
  taskIdentifier: string
  taskTitle: string
  workspaceSlug: string
  startedAt: string
}

function configDir(): string {
  return process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
}

export function currentTaskPath(): string {
  return path.join(configDir(), 'current-task.json')
}

export function readCurrentTask(): CurrentTask | null {
  const p = currentTaskPath()
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
    return data as CurrentTask
  } catch {
    return null
  }
}

export function writeCurrentTask(task: CurrentTask): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  }
  fs.writeFileSync(currentTaskPath(), JSON.stringify(task, null, 2), {
    mode: 0o600,
  })
}

export function clearCurrentTask(): boolean {
  const p = currentTaskPath()
  if (!fs.existsSync(p)) return false
  fs.unlinkSync(p)
  return true
}
