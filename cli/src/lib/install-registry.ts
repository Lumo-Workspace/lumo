import * as fs from 'fs'
import * as path from 'path'
import { configDir } from './config'
import { MARKER_FILE } from './skill-hash'

export type InstallKind = 'skill' | 'claude-settings' | 'git-hook'

export interface InstallRecord {
  kind: InstallKind
  /** Absolute path of the installed artifact. */
  path: string
  scope: 'user' | 'project'
  agent: string
  version: string
  hash?: string
  installedAt: string
}

/** Agent label for prepare-commit-msg installs: the hook serves git, not an agent. */
export const GIT_HOOK_AGENT = 'git'

/**
 * The agent a record belongs to for display and `--agent` filtering. Git-hook
 * records are always `git`, whatever an older CLI wrote into them.
 */
export function recordAgent(
  rec: Pick<InstallRecord, 'kind' | 'agent'>
): string {
  return rec.kind === 'git-hook' ? GIT_HOOK_AGENT : rec.agent
}

export interface SyncAttempt {
  version: string
  /** ISO timestamp of the last auto-sync slow path that did not finish clean. */
  at: string
}

export interface InstallRegistry {
  lastSyncedVersion: string | null
  /** Throttles auto-sync retries for the same version (LUM-1052 I2). */
  lastSyncAttempt?: SyncAttempt
  installs: InstallRecord[]
}

export interface InstallMarker {
  version: string
  hash: string
  agent: string
  installedAt: string
}

export function registryPath(): string {
  return path.join(configDir(), 'installs.json')
}

const empty = (): InstallRegistry => ({ lastSyncedVersion: null, installs: [] })

function isRecord(v: unknown): v is InstallRecord {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.kind === 'string' &&
    typeof r.path === 'string' &&
    typeof r.scope === 'string' &&
    typeof r.agent === 'string' &&
    typeof r.version === 'string' &&
    typeof r.installedAt === 'string'
  )
}

/** Read the registry; a missing or corrupt file yields an empty registry. */
export function readRegistry(): InstallRegistry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(), 'utf8')) as Record<
      string,
      unknown
    >
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.installs))
      return empty()
    const attempt = raw.lastSyncAttempt as Record<string, unknown> | undefined
    return {
      lastSyncedVersion:
        typeof raw.lastSyncedVersion === 'string'
          ? raw.lastSyncedVersion
          : null,
      ...(attempt &&
      typeof attempt.version === 'string' &&
      typeof attempt.at === 'string'
        ? { lastSyncAttempt: { version: attempt.version, at: attempt.at } }
        : {}),
      installs: raw.installs.filter(isRecord),
    }
  } catch {
    return empty()
  }
}

/**
 * Like readRegistry, but reports an existing-yet-unparseable file so callers
 * that would rewrite it can refuse instead of clobbering it. A missing file is
 * a normal empty registry.
 */
export function readRegistryChecked(): {
  registry: InstallRegistry
  corrupt: boolean
} {
  let text: string
  try {
    text = fs.readFileSync(registryPath(), 'utf8')
  } catch {
    return { registry: empty(), corrupt: false }
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.installs))
      return { registry: empty(), corrupt: true }
  } catch {
    return { registry: empty(), corrupt: true }
  }
  return { registry: readRegistry(), corrupt: false }
}

export function writeRegistry(reg: InstallRegistry): void {
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2) + '\n')
}

export function upsertInstall(rec: InstallRecord): void {
  const reg = readRegistry()
  const i = reg.installs.findIndex(
    x => x.kind === rec.kind && x.path === rec.path
  )
  if (i >= 0) reg.installs[i] = rec
  else reg.installs.push(rec)
  writeRegistry(reg)
}

export function removeInstall(kind: InstallKind, installPath: string): void {
  const reg = readRegistry()
  reg.installs = reg.installs.filter(
    x => !(x.kind === kind && x.path === installPath)
  )
  writeRegistry(reg)
}

/** Read `.lumo-install.json` from a skill dir; null if absent or invalid. */
export function readMarker(dir: string): InstallMarker | null {
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(dir, MARKER_FILE), 'utf8')
    ) as Record<string, unknown>
    if (typeof m.version !== 'string' || typeof m.hash !== 'string') return null
    return m as unknown as InstallMarker
  } catch {
    return null
  }
}

export function writeMarker(dir: string, marker: InstallMarker): void {
  fs.writeFileSync(
    path.join(dir, MARKER_FILE),
    JSON.stringify(marker, null, 2) + '\n'
  )
}
