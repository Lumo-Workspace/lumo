import * as fs from 'fs'
import * as path from 'path'
import { ENUM_TO_TOKEN, normalizeAgent } from './agent'
import { listFiles } from './codex-plugin'
import { codexHooksPath } from './codex-hooks'
import { classifyCodexRules, codexRulesPath } from './codex-rules'
import { mergeGitHook, LUMO_HOOK_BEGIN } from './git-hook-template'
import { resolveGitHooksDir } from './git-hooks-dir'
import {
  isLumoHookCommand,
  LUMO_HOOK_EVENTS,
  mergeLumoHooks,
  type MergeStats,
} from './hooks-template'
import {
  isLumoSkillSource,
  repoRoot,
  detectInstalledSkills,
} from './install-locations'
import { readMarker, type InstallRecord } from './install-registry'
import { classifySkillDir, isNewerVersion } from './install-state'
import { MARKER_FILE } from './skill-hash'

/**
 * LUM-1113 — the read-only half of `lumo init` / `init --upgrade`: which
 * installs an upgrade visits and what it would do to each. `init` acts on
 * these decisions and `init --upgrade --dry-run` only reports them, so the
 * preview cannot drift from what the real run writes. Nothing here writes.
 */

type Scope = 'user' | 'project'

function filesEqual(src: string, dst: string): boolean {
  if (!fs.existsSync(dst)) return false
  if (fs.statSync(src).size !== fs.statSync(dst).size) return false
  return fs.readFileSync(src).equals(fs.readFileSync(dst))
}

/** Whether `dir` holds exactly `relFiles` (ignoring the Lumo marker). */
function sameFileSet(dir: string, relFiles: readonly string[]): boolean {
  const have = listFiles(dir).filter(f => f !== MARKER_FILE)
  return (
    have.length === relFiles.length && have.every((f, i) => f === relFiles[i])
  )
}

/**
 * What installing the bundled skill into `skillDir` does:
 * - `skipped-source`: the Lumo repo's own `.claude/skills/lumo` (never written);
 * - `skipped-newer`: a managed copy newer than the CLI (never downgraded, not even with force);
 * - `up-to-date`: nothing to copy; `adoptVersion` set when a marker would be written (legacy / identical copy);
 * - `skipped-modified`: edited locally and `force` is off;
 * - `write`: the whole dir is replaced by the bundle.
 */
export type SkillInstallDecision =
  | { kind: 'skipped-source' }
  | { kind: 'skipped-newer'; installed: string }
  | { kind: 'up-to-date'; adoptVersion: string | null; gitTracked: boolean }
  | { kind: 'skipped-modified'; gitTracked: boolean }
  | {
      kind: 'write'
      result: 'installed' | 'upgraded'
      /** Managed version being replaced; null for a fresh install or a modified copy. */
      fromVersion: string | null
      gitTracked: boolean
    }

export function decideSkillInstall(
  skillSrcDir: string,
  skillDir: string,
  force: boolean,
  cliVersion: string
): SkillInstallDecision {
  if (isLumoSkillSource(skillDir)) return { kind: 'skipped-source' }

  const relFiles = listFiles(skillSrcDir)
  const cls = classifySkillDir(skillDir)
  const installed = cls.state === 'managed' ? (cls.version ?? '0.0.0') : null
  if (installed !== null && isNewerVersion(cliVersion, installed)) {
    return { kind: 'skipped-newer', installed }
  }

  if (cls.state !== 'missing' && !force) {
    const allMatch = relFiles.every(rel =>
      filesEqual(path.join(skillSrcDir, rel), path.join(skillDir, rel))
    )
    // A modified copy is only adopted when it IS the bundle: same file set and
    // bytes. Bundled files + an extra user file must stay `modified`, or the
    // marker would make that user file Lumo-managed (and later deletable).
    const identical = allMatch && sameFileSet(skillDir, relFiles)
    const upToDate =
      cls.state === 'managed'
        ? allMatch || !isNewerVersion(installed!, cliVersion)
        : identical
    if (upToDate) {
      const adopt = !readMarker(skillDir) || cls.state === 'modified'
      return {
        kind: 'up-to-date',
        adoptVersion: adopt ? (allMatch ? cliVersion : installed!) : null,
        gitTracked: cls.gitTracked,
      }
    }
    if (cls.state === 'modified') {
      return { kind: 'skipped-modified', gitTracked: cls.gitTracked }
    }
    return {
      kind: 'write',
      result: 'upgraded',
      fromVersion: installed,
      gitTracked: cls.gitTracked,
    }
  }
  return {
    kind: 'write',
    result: cls.state === 'missing' ? 'installed' : 'upgraded',
    fromVersion: installed,
    gitTracked: cls.gitTracked,
  }
}

export interface HooksMergePlan {
  exists: boolean
  /** The file as read (null when missing). */
  raw: string | null
  /** Parsed content (`{}` when missing). */
  existing: unknown
  merged: ReturnType<typeof mergeLumoHooks>['merged']
  stats: MergeStats
  /** Whether merging writes the file (missing, or a Lumo entry added/updated). */
  writes: boolean
}

/**
 * Merge the Lumo hook entries into a hooks file's content without writing.
 * Throws when an existing file is not valid JSON.
 */
export function planHooksMerge(
  settingsPath: string,
  agentToken: string,
  events?: Parameters<typeof mergeLumoHooks>[2]
): HooksMergePlan {
  const exists = fs.existsSync(settingsPath)
  let raw: string | null = null
  let existing: unknown = {}
  if (exists) {
    raw = fs.readFileSync(settingsPath, 'utf8')
    try {
      existing = JSON.parse(raw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Cannot parse existing ${settingsPath}: ${msg}. Fix the JSON and re-run.`
      )
    }
  }
  const { merged, stats } = mergeLumoHooks(
    existing as Parameters<typeof mergeLumoHooks>[0],
    agentToken,
    events
  )
  const changed = stats.addedEvents.length + stats.updatedEvents.length
  return {
    exists,
    raw,
    existing,
    merged,
    stats,
    writes: !exists || changed > 0,
  }
}

export type GitHookRefreshPlan =
  | { status: 'absent' }
  | { status: 'unchanged' }
  | { status: 'updated'; existing: string; content: string }

/**
 * Bringing the Lumo block of an existing prepare-commit-msg up to date: only a
 * file that already carries the Lumo begin marker is a target.
 */
export function planGitHookRefresh(hookPath: string): GitHookRefreshPlan {
  if (!fs.existsSync(hookPath)) return { status: 'absent' }
  const existing = fs.readFileSync(hookPath, 'utf8')
  if (!existing.includes(LUMO_HOOK_BEGIN)) return { status: 'absent' }
  const { content, status } = mergeGitHook(existing)
  if (status === 'unchanged') return { status: 'unchanged' }
  return { status: 'updated', existing, content }
}

export interface UpgradeTargets {
  skills: Array<{ path: string; scope: Scope; agent: string }>
  claudeSettings: InstallRecord[]
  codexHooks: Array<{ path: string; scope: Scope }>
  codexRules: InstallRecord[]
  /** prepare-commit-msg candidates; files without the Lumo block are not installs. */
  gitHooks: Array<{ path: string; scope: Scope }>
}

/**
 * Every install `init --upgrade` visits: registry records plus the detected
 * standard locations, existing paths only, in the order the upgrade runs.
 */
export function collectUpgradeTargets(
  installs: readonly InstallRecord[],
  homeDir: string,
  cwd: string
): UpgradeTargets {
  const skills = new Map<
    string,
    { path: string; scope: Scope; agent: string }
  >()
  for (const r of installs) {
    if (r.kind === 'skill') {
      skills.set(r.path, { path: r.path, scope: r.scope, agent: r.agent })
    }
  }
  for (const l of detectInstalledSkills({ homeDir, cwd })) {
    if (!skills.has(l.path)) skills.set(l.path, l)
  }

  const gitHooks = new Map<string, Scope>()
  for (const r of installs) {
    if (r.kind === 'git-hook') gitHooks.set(r.path, r.scope)
  }
  const root = repoRoot(cwd)
  if (root) {
    // A core.hooksPath hook is user-managed (husky etc.): never rewritten here.
    const { dir, coreHooksPath } = resolveGitHooksDir(root)
    if (dir && !coreHooksPath) {
      const p = path.join(dir, 'prepare-commit-msg')
      if (!gitHooks.has(p)) gitHooks.set(p, 'project')
    }
  }

  const claudeSettings = installs.filter(
    r => r.kind === 'claude-settings' && fs.existsSync(r.path)
  )
  const codexRules = installs.filter(
    r => r.kind === 'codex-rules' && fs.existsSync(r.path)
  )
  // LUM-1108: a repo's committed `.claude/settings.json` / `.codex/rules/lumo.rules`
  // is an install even on a machine that never recorded it (a teammate's
  // clone), so `init --upgrade` — the fix the SessionStart reminder names —
  // reaches it too.
  if (root) {
    const settings = projectClaudeSettingsTarget(root)
    if (settings && !claudeSettings.some(r => r.path === settings.path))
      claudeSettings.push(projectRecord('claude-settings', settings))
    const rules = projectCodexRulesTarget(root)
    if (rules && !codexRules.some(r => r.path === rules))
      codexRules.push(
        projectRecord('codex-rules', { path: rules, agent: 'codex' })
      )
  }

  return {
    skills: [...skills.values()].filter(t => fs.existsSync(t.path)),
    claudeSettings,
    codexHooks: codexHookTargets(installs, homeDir, root),
    codexRules,
    gitHooks: [...gitHooks].map(([p, scope]) => ({ path: p, scope })),
  }
}

/** A detected (unrecorded) project install, shaped like a registry record. */
function projectRecord(
  kind: 'claude-settings' | 'codex-rules',
  t: { path: string; agent: string }
): InstallRecord {
  return {
    kind,
    path: t.path,
    scope: 'project',
    agent: t.agent,
    version: '',
    installedAt: '',
  }
}

/**
 * `<repo>/.claude/settings.json` when it carries Lumo hook entries, with the
 * agent token baked into them (`--agent <token>`; `claude-code` for a legacy
 * flagless entry). Null when missing, unreadable or without Lumo hooks.
 */
export function projectClaudeSettingsTarget(
  root: string
): { path: string; agent: string } | null {
  const file = path.join(root, '.claude', 'settings.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const hooks = (parsed as { hooks?: unknown } | null)?.hooks
  if (!hooks || typeof hooks !== 'object') return null
  for (const [event, slug] of LUMO_HOOK_EVENTS) {
    const groups = (hooks as Record<string, unknown>)[event]
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      const list = (g as { hooks?: unknown } | null)?.hooks
      if (!Array.isArray(list)) continue
      for (const h of list) {
        const cmd = (h as { command?: unknown } | null)?.command
        if (typeof cmd !== 'string' || !isLumoHookCommand(cmd, slug)) continue
        // Only the `--agent <token>` right after the slug, and only a known
        // agent: anything else falls back to the Claude Code default.
        const m = /^--agent (\S+)/.exec(cmd.slice(`lumo hook ${slug} `.length))
        const e = m?.[1] ? normalizeAgent(m[1]) : null
        return { path: file, agent: (e && ENUM_TO_TOKEN[e]) || 'claude-code' }
      }
    }
  }
  return null
}

/** `<repo>/.codex/rules/lumo.rules` while it still carries the Lumo marker. */
export function projectCodexRulesTarget(root: string): string | null {
  const file = codexRulesPath(root)
  const state = classifyCodexRules(file)
  return state === 'current' || state === 'outdated' ? file : null
}

/**
 * Codex hooks files `init --upgrade` refreshes: registry records plus the
 * standard user (`~/.codex/hooks.json`) and repo (`<repo>/.codex/hooks.json`)
 * locations when they already carry `lumo hook … --agent codex` entries.
 */
function codexHookTargets(
  installs: readonly InstallRecord[],
  homeDir: string,
  root: string | null
): Array<{ path: string; scope: Scope }> {
  const targets = new Map<string, Scope>()
  for (const r of installs) {
    if (r.kind === 'codex-hooks') targets.set(r.path, r.scope)
  }
  const standard: Array<[string, Scope]> = [[codexHooksPath(homeDir), 'user']]
  if (root) standard.push([codexHooksPath(root), 'project'])
  for (const [p, scope] of standard) {
    if (!targets.has(p) && hasLumoCodexHooks(p)) targets.set(p, scope)
  }
  return [...targets]
    .filter(([p]) => fs.existsSync(p))
    .map(([p, scope]) => ({ path: p, scope }))
}

export function hasLumoCodexHooks(file: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8').includes('--agent codex')
  } catch {
    return false
  }
}
