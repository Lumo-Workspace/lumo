import * as fs from 'fs'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'
import { configDir } from './config'
import { findCliPackageRoot } from './cli-version'
import { acquireFileLock, releaseFileLock } from './file-lock'

const PACKAGE_NAME = '@lumoai/cli'
const ATTEMPT_INTERVAL_MS = 1000 * 60 * 60 * 24
const LOCK_STALE_MS = 1000 * 60 * 5
const NPM_WAIT_MS = 1000 * 120
const ERROR_MAX = 200

export const AUTO_UPDATE_OFF_COMMAND = 'lumo update --auto off'

export type AutoUpdateEnv = Record<string, string | undefined>
export type AutoUpdateSource = 'default' | 'setting' | 'env' | 'ci'
export type AutoUpdateStatus = { enabled: boolean; source: AutoUpdateSource }

function settingsPath(): string {
  return path.join(configDir(), 'settings.json')
}
function statePath(): string {
  return path.join(configDir(), 'auto-update.json')
}
function lockPath(): string {
  return path.join(configDir(), 'auto-update.lock')
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Persist the user's choice, keeping any other keys in settings.json. */
export function writeAutoUpdateSetting(enabled: boolean): void {
  const file = settingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({ ...readJsonObject(file), autoUpdate: enabled }, null, 2) +
      '\n'
  )
}

/** Whether auto-update is on, and why (env > CI > setting > default on). */
export function getAutoUpdateStatus(
  env: AutoUpdateEnv = process.env
): AutoUpdateStatus {
  if (env.LUMO_NO_AUTO_UPDATE === '1') return { enabled: false, source: 'env' }
  const ci = env.CI
  if (ci && ci !== 'false' && ci !== '0')
    return { enabled: false, source: 'ci' }
  const setting = readJsonObject(settingsPath()).autoUpdate
  if (typeof setting === 'boolean')
    return { enabled: setting, source: 'setting' }
  return { enabled: true, source: 'default' }
}

/** One human line describing the state, with how to change it. */
export function describeAutoUpdate(status: AutoUpdateStatus): string {
  if (status.enabled)
    return `Auto-update: on — the CLI updates itself in the background; turn off with \`${AUTO_UPDATE_OFF_COMMAND}\``
  const why =
    status.source === 'env'
      ? 'LUMO_NO_AUTO_UPDATE is set'
      : status.source === 'ci'
        ? 'CI environment'
        : 'disabled in settings'
  return `Auto-update: off (${why}) — turn on with \`lumo update --auto on\``
}

type AttemptState = {
  lastAutoUpdateAttempt?: number | undefined
  lastError?: string | null
}

export function readAutoUpdateState(): AttemptState {
  const raw = readJsonObject(statePath())
  return {
    lastAutoUpdateAttempt:
      typeof raw.lastAutoUpdateAttempt === 'number'
        ? raw.lastAutoUpdateAttempt
        : undefined,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
  }
}

function writeAutoUpdateState(state: AttemptState): void {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(state))
  } catch {
    /* non-essential */
  }
}

type SpawnSyncFn = (
  cmd: string,
  args: string[],
  opts: { encoding: 'utf8'; timeout: number; shell: boolean }
) => { status: number | null; stdout?: string | null }

/**
 * True only when `pkgRoot` is `<npm root -g>/@lumoai/cli` — i.e. the running
 * CLI is a global npm install. `npm link`, monorepo dev, npx caches and any
 * failure to run npm all answer false.
 */
export function isGlobalNpmInstall(
  pkgRoot: string | null,
  run: SpawnSyncFn = spawnSync as unknown as SpawnSyncFn
): boolean {
  if (!pkgRoot) return false
  try {
    const res = run('npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32',
    })
    const root = (res.stdout ?? '').trim()
    if (res.status !== 0 || !root) return false
    return (
      fs.realpathSync(pkgRoot) ===
      fs.realpathSync(path.join(root, ...PACKAGE_NAME.split('/')))
    )
  } catch {
    return false
  }
}

export type AutoUpdateDeps = {
  env?: AutoUpdateEnv
  now?: () => number
  pkgRoot?: string | null
  spawnSync?: SpawnSyncFn
  spawn?: typeof spawn
}

/**
 * Worker-side auto-update: install `latest` globally when allowed. Never
 * throws and never prints — failures are recorded in auto-update.json and the
 * ordinary "Update available" notice keeps showing.
 */
export async function maybeAutoUpdate(
  current: string,
  latest: string,
  isNewer: (current: string, candidate: string) => boolean,
  deps: AutoUpdateDeps = {}
): Promise<void> {
  try {
    if (!getAutoUpdateStatus(deps.env).enabled) return
    if (!isNewer(current, latest)) return
    const now = (deps.now ?? Date.now)()
    const last = readAutoUpdateState().lastAutoUpdateAttempt
    if (last !== undefined && now - last < ATTEMPT_INTERVAL_MS) return
    if (!acquireFileLock(lockPath(), LOCK_STALE_MS)) return
    try {
      const root =
        deps.pkgRoot !== undefined ? deps.pkgRoot : findCliPackageRoot()
      if (!isGlobalNpmInstall(root, deps.spawnSync)) return
      writeAutoUpdateState({ lastAutoUpdateAttempt: now, lastError: null })
      const error = await installGlobally(latest, deps.spawn ?? spawn)
      if (error)
        writeAutoUpdateState({
          lastAutoUpdateAttempt: now,
          lastError: error.slice(0, ERROR_MAX),
        })
    } finally {
      releaseFileLock(lockPath())
    }
  } catch {
    /* never affect the CLI */
  }
}

/** Run npm detached from this worker; resolves to an error string or null. */
function installGlobally(
  version: string,
  spawnFn: typeof spawn
): Promise<string | null> {
  return new Promise(resolve => {
    let stderr = ''
    let done = false
    const finish = (err: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(err)
    }
    const timer = setTimeout(() => finish(null), NPM_WAIT_MS)
    try {
      const child = spawnFn(
        'npm',
        ['install', '-g', `${PACKAGE_NAME}@${version}`],
        {
          detached: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          shell: process.platform === 'win32',
        }
      )
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', e => finish(`failed to launch npm: ${e.message}`))
      child.on('close', code =>
        finish(
          code === 0
            ? null
            : `npm exited with code ${code}: ${stderr.trim().slice(-ERROR_MAX)}`
        )
      )
      child.unref()
    } catch (e) {
      finish(`failed to launch npm: ${(e as Error).message}`)
    }
  })
}
