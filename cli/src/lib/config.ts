import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface Credentials {
  token: string
  apiUrl: string
  userId: string
  email: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  apiKeyId: string
  apiKeyName: string
  apiKeyPrefix: string
}

function configDir(): string {
  return path.join(os.homedir(), '.lumo')
}

export function credentialsPath(): string {
  return path.join(configDir(), 'credentials.json')
}

export function readCredentials(): Credentials | null {
  const p = credentialsPath()
  if (!fs.existsSync(p)) return null
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (typeof data?.token !== 'string' || typeof data?.apiUrl !== 'string') {
      return null
    }
    return data as Credentials
  } catch {
    return null
  }
}

export function writeCredentials(creds: Credentials): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  } else {
    try {
      fs.chmodSync(dir, 0o700)
    } catch {
      // Best-effort perms tightening; continue if filesystem doesn't support chmod
    }
  }
  const p = credentialsPath()
  fs.writeFileSync(p, JSON.stringify(creds, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    // Best-effort perms tightening
  }
}

export function deleteCredentials(): boolean {
  const p = credentialsPath()
  if (!fs.existsSync(p)) return false
  fs.unlinkSync(p)
  return true
}
