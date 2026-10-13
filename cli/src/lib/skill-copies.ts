import * as fs from 'fs'
import * as path from 'path'
import { listFiles } from './codex-plugin'
import { readMarker, readRegistry } from './install-registry'
import {
  detectInstalledSkills,
  isLumoSkillSource,
  type InstallLocation,
} from './install-locations'
import { classifySkillDir, isNewerVersion } from './install-state'
import { MARKER_FILE } from './skill-hash'

/**
 * LUM-1107 — the skill-only view behind `lumo skill status` / `lumo skill
 * update`: which Lumo skill copies exist, how each compares to the CLI, and
 * what refreshing one from the bundled skill would change. Nothing here
 * writes; the command decides.
 */

/**
 * Version of the `lumo skill status --json` shape. Other features read it
 * (SessionStart version hint, stale committed-copy reminder): bump it on any
 * breaking change to {@link SkillStatusJson}; adding a field is not breaking.
 */
export const SKILL_STATUS_SCHEMA_VERSION = 1

/**
 * - `up-to-date` — managed copy at exactly the CLI's version
 * - `behind` — managed copy older than the CLI: `lumo skill update` refreshes it
 * - `newer` — managed copy newer than the CLI: never downgraded (`lumo update`)
 * - `modified` — edited locally: skipped unless `--force`
 * - `source` — the Lumo source repo's `.claude/skills/lumo`: never touched
 */
export type SkillCopyState =
  | 'up-to-date'
  | 'behind'
  | 'newer'
  | 'modified'
  | 'source'

export interface SkillCopyStatus {
  path: string
  scope: 'user' | 'project'
  agent: string
  /** Managed version; for a modified copy the version its marker last recorded; null when unknown. */
  version: string | null
  state: SkillCopyState
  /** Any file of the copy is tracked by git (updates are left uncommitted). */
  gitTracked: boolean
}

export interface SkillStatusJson {
  schemaVersion: number
  cliVersion: string
  skills: SkillCopyStatus[]
}

export interface CollectOptions {
  homeDir: string
  cwd: string
  scope?: 'user' | 'project'
  /** Agent token (`claude-code`, `codex`, …) the copy belongs to. */
  agent?: string
}

/**
 * Every existing skill copy: the known locations (user ~/.claude, ~/.agents
 * and the same two in the current repo) plus skill records in the install
 * registry (project installs in other repos). Missing paths are dropped.
 */
export function collectSkillCopies(opts: CollectOptions): InstallLocation[] {
  const locs = new Map<string, InstallLocation>()
  for (const l of detectInstalledSkills({
    homeDir: opts.homeDir,
    cwd: opts.cwd,
  }))
    locs.set(l.path, l)
  for (const rec of readRegistry().installs) {
    if (rec.kind !== 'skill' || locs.has(rec.path)) continue
    if (!fs.existsSync(rec.path)) continue
    locs.set(rec.path, { path: rec.path, scope: rec.scope, agent: rec.agent })
  }
  return [...locs.values()].filter(
    l =>
      (opts.scope === undefined || l.scope === opts.scope) &&
      (opts.agent === undefined || l.agent === opts.agent)
  )
}

/** Classify one copy against the running CLI version. */
export function skillCopyStatus(
  loc: InstallLocation,
  cliVersion: string
): SkillCopyStatus {
  const cls = classifySkillDir(loc.path)
  // Key order is part of the --json contract: path, scope, agent, version, state, gitTracked.
  const row = (
    version: string | null,
    state: SkillCopyState
  ): SkillCopyStatus => ({
    path: loc.path,
    scope: loc.scope,
    agent: loc.agent,
    version,
    state,
    gitTracked: cls.gitTracked,
  })
  if (isLumoSkillSource(loc.path)) return row(cls.version ?? null, 'source')
  if (cls.state !== 'managed')
    return row(readMarker(loc.path)?.version ?? null, 'modified')
  const v = cls.version ?? '0.0.0'
  return row(
    v,
    isNewerVersion(v, cliVersion)
      ? 'behind'
      : isNewerVersion(cliVersion, v)
        ? 'newer'
        : 'up-to-date'
  )
}

export interface SkillFileChange {
  /** Path relative to the skill dir (`/`-separated). */
  file: string
  change: 'added' | 'modified' | 'deleted'
  /** Lines only in the bundled file (approximate: multiset line diff). */
  linesAdded: number
  /** Lines only in the installed file. */
  linesRemoved: number
}

function lines(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  if (text === '') return []
  const out = text.split('\n')
  if (out[out.length - 1] === '') out.pop()
  return out
}

/** Lines of `a` not matched by an equal line of `b` (each match used once). */
function unmatched(a: readonly string[], b: readonly string[]): number {
  const pool = new Map<string, number>()
  for (const l of b) pool.set(l, (pool.get(l) ?? 0) + 1)
  let n = 0
  for (const l of a) {
    const c = pool.get(l) ?? 0
    if (c > 0) pool.set(l, c - 1)
    else n++
  }
  return n
}

const rel = (p: string): string => p.split(path.sep).join('/')

/**
 * What replacing `installedDir` with `bundledDir` would change, file by file
 * (the install marker excluded). Sorted by path; empty when byte-identical.
 */
export function diffSkillDirs(
  bundledDir: string,
  installedDir: string
): SkillFileChange[] {
  const want = new Set(listFiles(bundledDir))
  const have = new Set(
    fs.existsSync(installedDir)
      ? listFiles(installedDir).filter(f => f !== MARKER_FILE)
      : []
  )
  const out: SkillFileChange[] = []
  for (const f of want) {
    const src = path.join(bundledDir, f)
    const dst = path.join(installedDir, f)
    if (!have.has(f)) {
      out.push({
        file: rel(f),
        change: 'added',
        linesAdded: lines(src).length,
        linesRemoved: 0,
      })
      continue
    }
    if (fs.readFileSync(src).equals(fs.readFileSync(dst))) continue
    const a = lines(src)
    const b = lines(dst)
    out.push({
      file: rel(f),
      change: 'modified',
      linesAdded: unmatched(a, b),
      linesRemoved: unmatched(b, a),
    })
  }
  for (const f of have) {
    if (want.has(f)) continue
    out.push({
      file: rel(f),
      change: 'deleted',
      linesAdded: 0,
      linesRemoved: lines(path.join(installedDir, f)).length,
    })
  }
  return out.sort((x, y) => x.file.localeCompare(y.file))
}
