import * as fs from 'fs'
import * as path from 'path'
import { ENUM_TO_TOKEN, normalizeAgent } from './agent'
import { listFiles } from './codex-plugin'
import { classifyCodexRules, codexRulesPath } from './codex-rules'
import { mergeGitHook, resolveHookInstall } from './git-hook-template'
import { gitCapture, resolveGitHooksDir } from './git-hooks-dir'
import {
  isLumoHookCommand,
  LUMO_HOOK_EVENTS,
  mergeLumoHooks,
  RETIRED_LUMO_HOOK_EVENTS,
  type MergeStats,
} from './hooks-template'
import { isLumoSkillSource } from './install-locations'
import { readMarker } from './install-registry'
import { classifySkillDir, isNewerVersion } from './install-state'
import { MARKER_FILE } from './skill-hash'

/**
 * LUM-1113 / LUM-1118 — the read-only half of `lumo init`: what it would do
 * to each install of the chosen scope. `init` acts on these decisions and
 * `init --dry-run` only reports them, so the preview cannot drift from what
 * the real run writes. Nothing here writes.
 */

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
  /** Whether merging writes the file (missing, or a Lumo entry added/updated/removed). */
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
  const changed =
    stats.addedEvents.length +
    stats.updatedEvents.length +
    stats.removedEvents.length
  return {
    exists,
    raw,
    existing,
    merged,
    stats,
    writes: !exists || changed > 0,
  }
}

export type GitHookInstallPlan =
  | { status: 'not-repo' }
  /** `core.hooksPath` is set (husky etc.): init prints the block instead. */
  | { status: 'degrade'; coreHooksPath: string }
  | { status: 'no-dir' }
  | { status: 'unchanged'; hookPath: string }
  | {
      status: 'created' | 'appended' | 'updated'
      hookPath: string
      /** The hook as read (null when missing). */
      existing: string | null
      content: string
    }

/**
 * What `lumo init --project` does to the repo's prepare-commit-msg: create
 * it, append the Lumo block to a foreign hook, replace a stale block, or
 * nothing. A configured `core.hooksPath` is never written.
 */
export function planGitHookInstall(projectRoot: string): GitHookInstallPlan {
  if (
    gitCapture(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true'
  )
    return { status: 'not-repo' }
  const { dir, coreHooksPath } = resolveGitHooksDir(projectRoot)
  if (resolveHookInstall(coreHooksPath).mode === 'degrade')
    return { status: 'degrade', coreHooksPath: coreHooksPath! }
  if (!dir) return { status: 'no-dir' }
  const hookPath = path.join(dir, 'prepare-commit-msg')
  const existing = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, 'utf8')
    : null
  const { content, status } = mergeGitHook(existing)
  if (status === 'unchanged') return { status, hookPath }
  return { status, hookPath, existing, content }
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
  for (const [event, slug] of [
    ...LUMO_HOOK_EVENTS,
    ...RETIRED_LUMO_HOOK_EVENTS,
  ]) {
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

export function hasLumoCodexHooks(file: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8').includes('--agent codex')
  } catch {
    return false
  }
}
