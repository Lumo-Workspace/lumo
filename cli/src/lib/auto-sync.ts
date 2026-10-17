import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { configDir } from './config'
import { readCliVersion } from './cli-version'
import { bundledSkillDir, copySkillTree } from './codex-plugin'
import { acquireFileLock } from './file-lock'
import { mergeLumoHooks } from './hooks-template'
import {
  isLumoSkillSource,
  isSkillsLumoPath,
  userSkillLocations,
} from './install-locations'
import {
  readRegistry,
  readMarker,
  readRegistryChecked,
  upsertInstall,
  writeMarker,
  writeRegistry,
  type InstallRecord,
} from './install-registry'
import {
  classifySkillDir,
  isNewerVersion,
  isPathGitTracked,
} from './install-state'
import { hashSkillDir } from './skill-hash'

/** Commands that must never trigger the first-run-of-a-version sync. */
const NO_AUTO_SYNC_COMMANDS = new Set(['doctor', 'uninstall', 'skill'])

/**
 * Whether `maybeAutoSync` may run for this invocation. `doctor` and `skill
 * status` are read-only, `uninstall` removes installs and `skill update`
 * must write only what it reports (nothing under --dry-run, never hooks), so
 * none of them may rewrite installs first.
 */
export function shouldAutoSync(argv: readonly string[]): boolean {
  return !NO_AUTO_SYNC_COMMANDS.has(argv[2] ?? '') && !isInitDryRun(argv)
}

/**
 * LUM-1113: `lumo init --dry-run` (or `setup …`) promises zero
 * writes, so neither the first-run sync nor the update check / background
 * auto-update may run before it.
 */
export function isInitDryRun(argv: readonly string[]): boolean {
  return (
    (argv[2] === 'init' || argv[2] === 'setup') &&
    argv.slice(3).includes('--dry-run')
  )
}

/**
 * Whether the update notice and the background refresh/auto-update worker may
 * run. Not for `uninstall` (nor an init dry run): the worker could reinstall the CLI right after
 * `npm rm -g`, or recreate ~/.lumo after `--purge`.
 */
export function shouldCheckForUpdates(argv: readonly string[]): boolean {
  return argv[2] !== 'uninstall' && !isInitDryRun(argv)
}

const LOCK_FILE = 'auto-sync.lock'
const LOCK_STALE_MS = 60_000
/** A failed slow path for the same version is retried at most this often. */
const RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000

export type AutoSyncOptions = {
  /** Directory holding the bundled skill (defaults to the packaged assets). */
  bundledSkillDir?: string
  /** Where the one-line success notice goes (defaults to stderr). */
  log?: (line: string) => void
  /** Suppress all output (e.g. `lumo hook …`, whose output the agent reads). */
  quiet?: boolean
  /** Home dir whose user-scope skill dirs may be adopted (defaults to ~). */
  homeDir?: string
  /** Clock seam for the retry throttle. */
  now?: () => number
}

/** Take the sync lock; false when another process holds a fresh one. */
function acquireLock(lockPath: string): boolean {
  return acquireFileLock(lockPath, LOCK_STALE_MS)
}

/** Replace a managed skill dir with the bundled copy and a fresh marker. */
function replaceSkill(
  bundled: string,
  rec: InstallRecord,
  version: string
): void {
  copySkillTree(bundled, rec.path)
  const hash = hashSkillDir(rec.path)
  const installedAt = new Date().toISOString()
  writeMarker(rec.path, { version, hash, agent: rec.agent, installedAt })
  upsertInstall({ ...rec, version, hash, installedAt })
}

type SkillSync =
  | { kind: 'updated' }
  | { kind: 'newer'; installed: string }
  | { kind: 'not-skills-lumo' }
  | { kind: 'none' }

function syncSkill(
  rec: InstallRecord,
  version: string,
  bundled: string
): SkillSync {
  if (!isSkillsLumoPath(rec.path)) return { kind: 'not-skills-lumo' }
  if (isLumoSkillSource(rec.path)) return { kind: 'none' }
  const cls = classifySkillDir(rec.path)
  if (cls.state !== 'managed' || cls.gitTracked) return { kind: 'none' }
  const installed = cls.version ?? '0.0.0'
  if (isNewerVersion(version, installed)) return { kind: 'newer', installed }
  if (!isNewerVersion(installed, version)) return { kind: 'none' }
  if (!fs.existsSync(path.join(bundled, 'SKILL.md')))
    throw new Error(`bundled skill missing at ${bundled}`)
  replaceSkill(bundled, rec, version)
  return { kind: 'updated' }
}

/** Re-merge Lumo hooks only when the Lumo event set differs (incl. retired ones). */
function syncSettings(rec: InstallRecord, version: string): void {
  if (!fs.existsSync(rec.path) || isPathGitTracked(rec.path)) return
  const existing = JSON.parse(fs.readFileSync(rec.path, 'utf8')) as Parameters<
    typeof mergeLumoHooks
  >[0]
  const { merged, stats } = mergeLumoHooks(existing, rec.agent)
  if (
    stats.addedEvents.length +
      stats.updatedEvents.length +
      stats.removedEvents.length ===
    0
  )
    return
  fs.writeFileSync(rec.path, JSON.stringify(merged, null, 2) + '\n')
  upsertInstall({ ...rec, version, installedAt: new Date().toISOString() })
}

/**
 * Pre-registry installs (`~/.claude/skills/lumo`, `~/.agents/skills/lumo` with
 * no record): adopt a managed, untracked copy — marker (if absent) plus a
 * registry record — so the sync below treats it like any other install.
 * Modified, git-tracked and source copies are left alone.
 */
function adoptLegacyUserSkills(
  home: string,
  recorded: readonly InstallRecord[]
): boolean {
  let clean = true
  for (const loc of userSkillLocations(home)) {
    if (recorded.some(r => r.kind === 'skill' && r.path === loc.path)) continue
    try {
      if (!fs.existsSync(loc.path) || isLumoSkillSource(loc.path)) continue
      const cls = classifySkillDir(loc.path)
      if (cls.state !== 'managed' || cls.gitTracked) continue
      const version = cls.version ?? '0.0.0'
      const hash = hashSkillDir(loc.path)
      const installedAt = new Date().toISOString()
      if (!readMarker(loc.path))
        writeMarker(loc.path, { version, hash, agent: loc.agent, installedAt })
      upsertInstall({
        kind: 'skill',
        path: loc.path,
        scope: 'user',
        agent: loc.agent,
        version,
        hash,
        installedAt,
      })
    } catch {
      clean = false
    }
  }
  return clean
}

/** True when a failed attempt at this version happened under 6h ago. */
function recentlyAttempted(
  reg: { lastSyncAttempt?: { version: string; at: string } },
  version: string,
  now: number
): boolean {
  const a = reg.lastSyncAttempt
  if (!a || a.version !== version) return false
  const at = Date.parse(a.at)
  return Number.isFinite(at) && now - at < RETRY_INTERVAL_MS
}

/**
 * First run of a new CLI version: bring user-scope, untracked, unmodified
 * installs up to date. Never throws; never touches project-scope or
 * git-tracked paths (those need an explicit `lumo init --project`).
 */
export function maybeAutoSync(
  currentVersion: string | null = readCliVersion(),
  opts: AutoSyncOptions = {}
): void {
  try {
    if (!currentVersion) return
    const now = (opts.now ?? Date.now)()
    const first = readRegistryChecked()
    if (first.corrupt) return
    if (first.registry.lastSyncedVersion === currentVersion) return
    if (recentlyAttempted(first.registry, currentVersion, now)) return

    const lockPath = path.join(configDir(), LOCK_FILE)
    if (!acquireLock(lockPath)) return
    try {
      const locked = readRegistryChecked()
      if (locked.corrupt) return
      if (locked.registry.lastSyncedVersion === currentVersion) return
      if (recentlyAttempted(locked.registry, currentVersion, now)) return
      const bundled = opts.bundledSkillDir ?? bundledSkillDir()
      const log =
        opts.log ?? ((line: string) => void process.stderr.write(line + '\n'))
      let clean = adoptLegacyUserSkills(
        opts.homeDir ?? os.homedir(),
        locked.registry.installs
      )
      for (const rec of readRegistry().installs) {
        if (rec.scope !== 'user') continue
        try {
          if (rec.kind === 'skill') {
            const res = syncSkill(rec, currentVersion, bundled)
            if (opts.quiet) continue
            if (res.kind === 'updated')
              log(`✓ Lumo skill updated to ${currentVersion}: ${rec.path}`)
            else if (res.kind === 'newer')
              log(
                `⚠ Lumo skill at ${rec.path} is ${res.installed}, newer than this CLI (${currentVersion}) — run lumo update`
              )
            else if (res.kind === 'not-skills-lumo')
              log(
                `⚠ Lumo auto-sync skipped ${rec.path}: not a skills/lumo directory`
              )
          } else if (rec.kind === 'claude-settings') {
            syncSettings(rec, currentVersion)
          }
        } catch {
          clean = false
        }
      }
      const fresh = readRegistry()
      if (clean) {
        fresh.lastSyncedVersion = currentVersion
        delete fresh.lastSyncAttempt
      } else {
        fresh.lastSyncAttempt = {
          version: currentVersion,
          at: new Date(now).toISOString(),
        }
      }
      writeRegistry(fresh)
    } finally {
      fs.rmSync(lockPath, { force: true })
    }
  } catch {
    // auto-sync must never affect the command being run
  }
}
