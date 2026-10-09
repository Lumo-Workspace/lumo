import * as fs from 'fs'
import * as path from 'path'
import { configDir } from './config'
import { readCliVersion } from './cli-version'
import { BUNDLED_SKILL_REL, listFiles } from './codex-plugin'
import { mergeLumoHooks } from './hooks-template'
import {
  readRegistry,
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

const LOCK_FILE = 'auto-sync.lock'
const LOCK_STALE_MS = 60_000

export type AutoSyncOptions = {
  /** Directory holding the bundled skill (defaults to the packaged assets). */
  bundledSkillDir?: string
  /** Where the one-line success notice goes (defaults to stderr). */
  log?: (line: string) => void
  /** Suppress all output (e.g. `lumo hook …`, whose output the agent reads). */
  quiet?: boolean
}

function defaultBundledDir(): string {
  return path.resolve(__dirname, '../../..', BUNDLED_SKILL_REL)
}

/** Take the sync lock; false when another process holds a fresh one. */
function acquireLock(lockPath: string): boolean {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'))
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs < LOCK_STALE_MS)
          return false
        fs.rmSync(lockPath, { force: true })
      } catch {
        return false
      }
    }
  }
  return false
}

/** Replace a managed skill dir with the bundled copy and a fresh marker. */
function replaceSkill(
  bundled: string,
  rec: InstallRecord,
  version: string
): void {
  const files = listFiles(bundled)
  fs.rmSync(rec.path, { recursive: true, force: true })
  for (const rel of files) {
    const dst = path.join(rec.path, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(bundled, rel), dst)
  }
  const hash = hashSkillDir(rec.path)
  const installedAt = new Date().toISOString()
  writeMarker(rec.path, { version, hash, agent: rec.agent, installedAt })
  upsertInstall({ ...rec, version, hash, installedAt })
}

/** Returns the updated path, or null when nothing was written. */
function syncSkill(
  rec: InstallRecord,
  version: string,
  bundled: string
): string | null {
  const cls = classifySkillDir(rec.path)
  if (cls.state !== 'managed' || cls.gitTracked) return null
  if (!isNewerVersion(cls.version ?? '0.0.0', version)) return null
  if (!fs.existsSync(path.join(bundled, 'SKILL.md'))) return null
  replaceSkill(bundled, rec, version)
  return rec.path
}

/** Re-merge Lumo hooks only when the Lumo event set differs. */
function syncSettings(rec: InstallRecord, version: string): void {
  if (!fs.existsSync(rec.path) || isPathGitTracked(rec.path)) return
  const existing = JSON.parse(fs.readFileSync(rec.path, 'utf8')) as Parameters<
    typeof mergeLumoHooks
  >[0]
  const { merged, stats } = mergeLumoHooks(existing, rec.agent)
  if (stats.addedEvents.length + stats.updatedEvents.length === 0) return
  fs.writeFileSync(rec.path, JSON.stringify(merged, null, 2) + '\n')
  upsertInstall({ ...rec, version, installedAt: new Date().toISOString() })
}

/**
 * First run of a new CLI version: bring user-scope, untracked, unmodified
 * installs up to date. Never throws; never touches project-scope or
 * git-tracked paths (those need an explicit `lumo init --upgrade`).
 */
export function maybeAutoSync(
  currentVersion: string | null = readCliVersion(),
  opts: AutoSyncOptions = {}
): void {
  try {
    if (!currentVersion) return
    if (readRegistry().lastSyncedVersion === currentVersion) return

    const lockPath = path.join(configDir(), LOCK_FILE)
    if (!acquireLock(lockPath)) return
    try {
      const reg = readRegistry()
      if (reg.lastSyncedVersion === currentVersion) return
      const bundled = opts.bundledSkillDir ?? defaultBundledDir()
      const log =
        opts.log ?? ((line: string) => void process.stderr.write(line + '\n'))
      let clean = true
      for (const rec of reg.installs) {
        if (rec.scope !== 'user') continue
        try {
          if (rec.kind === 'skill') {
            const updated = syncSkill(rec, currentVersion, bundled)
            if (updated && !opts.quiet)
              log(`✓ Lumo skill updated to ${currentVersion}: ${updated}`)
          } else if (rec.kind === 'claude-settings') {
            syncSettings(rec, currentVersion)
          }
        } catch {
          clean = false
        }
      }
      if (clean) {
        const fresh = readRegistry()
        fresh.lastSyncedVersion = currentVersion
        writeRegistry(fresh)
      }
    } finally {
      fs.rmSync(lockPath, { force: true })
    }
  } catch {
    // auto-sync must never affect the command being run
  }
}
