import * as fs from 'fs'
import * as path from 'path'
import { ENUM_TO_TOKEN, normalizeAgent } from './agent'
import { classifyCodexRules, codexRulesPath } from './codex-rules'
import {
  mergeGitHook,
  PREPARE_COMMIT_MSG_HOOK,
  resolveHookInstall,
  type GitHookSpec,
} from './git-hook-template'
import { gitCapture, resolveGitHooksDir } from './git-hooks-dir'
import {
  isLumoHookEntry,
  mergeLumoHooks,
  type MergeStats,
} from './hooks-template'

/**
 * LUM-1113 / LUM-1118 — the read-only half of `lumo init`: what it would do
 * to each file of the current repo. `init` acts on these decisions and
 * `init --dry-run` only reports them, so the preview cannot drift from what
 * the real run writes. Nothing here writes.
 */

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
 * What `lumo init` does to the repo's prepare-commit-msg (or,
 * LUM-1258, a scan hook `spec` names): create it, append the Lumo block to a
 * foreign hook, replace a stale block, or nothing. A configured
 * `core.hooksPath` is never written.
 */
export function planGitHookInstall(
  projectRoot: string,
  spec: GitHookSpec = PREPARE_COMMIT_MSG_HOOK
): GitHookInstallPlan {
  if (
    gitCapture(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true'
  )
    return { status: 'not-repo' }
  const { dir, coreHooksPath } = resolveGitHooksDir(projectRoot)
  if (resolveHookInstall(coreHooksPath).mode === 'degrade')
    return { status: 'degrade', coreHooksPath: coreHooksPath! }
  if (!dir) return { status: 'no-dir' }
  const hookPath = path.join(dir, spec.hook)
  const existing = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, 'utf8')
    : null
  const { content, status } = mergeGitHook(existing, spec)
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
  for (const groups of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) {
      const list = (g as { hooks?: unknown } | null)?.hooks
      if (!Array.isArray(list)) continue
      for (const h of list) {
        const cmd = (h as { command?: unknown } | null)?.command
        if (typeof cmd !== 'string' || !isLumoHookEntry(cmd)) continue
        // Only the `--agent <token>` right after the slug, and only a known
        // agent: anything else falls back to the Claude Code default.
        const m = /^lumo hook \S+ --agent (\S+)/.exec(cmd)
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
