import * as fs from 'fs'
import * as path from 'path'
import { codexHooksPath } from './codex-hooks'
import { classifyCodexRules } from './codex-rules'
import { acquireFileLock, releaseFileLock } from './file-lock'
import { CODEX_HOOK_EVENTS, retiredLumoHookEvents } from './hooks-template'
import {
  hasLumoCodexHooks,
  planHooksMerge,
  projectClaudeSettingsTarget,
  projectCodexRulesTarget,
} from './install-plan'
import { isLumoSkillSource, repoRoot } from './install-locations'
import { isPathGitTracked } from './install-state'
import { skillCopyStatus } from './skill-copies'

/**
 * LUM-1108 — the committed (git-tracked) Lumo install of the current repo
 * that is behind the running CLI: project skill copies, `.claude/settings.json`
 * hooks, `.codex/hooks.json` and `.codex/rules/lumo.rules`. Auto-sync never
 * touches these (they are shared with the team through git), so the
 * SessionStart status line names them once per session with the fix command.
 * The decisions are the ones `lumo skill update` / `lumo init --project`
 * act on. Purely local and read-only; every entry point swallows its failures.
 *
 * LUM-1235 — one exception to "committed only": an uncommitted
 * `.claude/settings.json` that still holds Lumo's retired hook entries
 * (`claude-settings-retired`). Auto-sync is user-scope only, so nothing else
 * would point at it, and its retired WorktreeCreate hook breaks every Claude
 * Code worktree. It gets its own note (`retiredHooksNote`), without the PR step.
 */

export type ProjectDriftKind =
  | 'skill'
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-rules'
  | 'claude-settings-retired'

export interface ProjectDriftItem {
  kind: ProjectDriftKind
  /** Absolute path. */
  path: string
  /** Path relative to the repo root, for the reminder. */
  relPath: string
  /** Skill copies: the managed version that is behind. */
  version: string | null
  /** Agent token the install belongs to (the `--agent` of its refresh). */
  agent: string
  /** `claude-settings-retired`: the retired events that still carry Lumo entries. */
  retiredEvents?: string[]
}

/** Never throws: an unreadable / unplannable file is simply not reported. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/**
 * Every git-tracked Lumo install in the repo of `cwd` that the CLI would
 * update. Empty outside a git repo, with no install, or when all are current.
 */
export function projectInstallDrift(opts: {
  cwd: string
  cliVersion: string
}): ProjectDriftItem[] {
  const root = safe(() => repoRoot(opts.cwd), null)
  if (!root) return []
  const items: ProjectDriftItem[] = []
  const add = (
    kind: ProjectDriftKind,
    file: string,
    agent: string,
    version: string | null = null
  ): void => {
    items.push({
      kind,
      path: file,
      relPath: path.relative(root, file),
      version,
      agent,
    })
  }

  for (const [dir, agent] of [
    ['.claude', 'claude-code'],
    ['.agents', 'codex'],
  ] as const) {
    const skill = path.join(root, dir, 'skills', 'lumo')
    if (!fs.existsSync(skill) || safe(() => isLumoSkillSource(skill), true))
      continue
    const copy = safe(
      () =>
        skillCopyStatus(
          { path: skill, scope: 'project', agent },
          opts.cliVersion
        ),
      null
    )
    if (copy?.state === 'behind' && copy.gitTracked)
      add('skill', skill, agent, copy.version)
  }

  const behindAndTracked = (file: string, behind: () => boolean): boolean =>
    safe(behind, false) && safe(() => isPathGitTracked(file), false)

  const settings = safe(() => projectClaudeSettingsTarget(root), null)
  if (
    settings &&
    behindAndTracked(
      settings.path,
      () => planHooksMerge(settings.path, settings.agent).writes
    )
  )
    add('claude-settings', settings.path, settings.agent)
  else if (settings && !safe(() => isPathGitTracked(settings.path), true)) {
    const retired = safe(
      () =>
        retiredLumoHookEvents(
          (
            JSON.parse(fs.readFileSync(settings.path, 'utf8')) as {
              hooks?: unknown
            }
          ).hooks
        ),
      []
    )
    if (retired.length > 0)
      items.push({
        kind: 'claude-settings-retired',
        path: settings.path,
        relPath: path.relative(root, settings.path),
        version: null,
        agent: settings.agent,
        retiredEvents: retired,
      })
  }

  const codexHooks = codexHooksPath(root)
  if (
    safe(() => hasLumoCodexHooks(codexHooks), false) &&
    behindAndTracked(
      codexHooks,
      () => planHooksMerge(codexHooks, 'codex', CODEX_HOOK_EVENTS).writes
    )
  )
    add('codex-hooks', codexHooks, 'codex')

  const rules = safe(() => projectCodexRulesTarget(root), null)
  if (
    rules &&
    behindAndTracked(rules, () => classifyCodexRules(rules) === 'outdated')
  )
    add('codex-rules', rules, 'codex')

  return items
}

/**
 * One status-line segment naming what is behind and how to fix it: skill
 * copies → `lumo skill update --project` (never touches hooks, so Codex keeps
 * its trust); hooks / rules → re-run `lumo init --project` (narrowed with
 * `--agent` when they all belong to one agent), previewed with `--dry-run`.
 * Either way the result is uncommitted: open a PR. `restart` adds the
 * restart step when the session's own skill copy is among them.
 */
export function projectDriftNote(
  items: readonly ProjectDriftItem[],
  cliVersion: string,
  opts: { restart?: boolean } = {}
): string | null {
  items = items.filter(i => i.kind !== 'claude-settings-retired')
  if (items.length === 0) return null
  const what = items
    .map(i => (i.version ? `${i.relPath} ${i.version}` : i.relPath))
    .join(', ')
  const cmds: string[] = []
  if (items.some(i => i.kind === 'skill'))
    cmds.push('`lumo skill update --project`')
  const hooks = items.filter(i => i.kind !== 'skill')
  if (hooks.length > 0) {
    const agents = [...new Set(hooks.map(i => i.agent))]
    const init = `lumo init --project${agents.length === 1 ? ` --agent ${agents[0]}` : ''}`
    cmds.push(`\`${init}\` (preview with \`--dry-run\`)`)
  }
  const then = opts.restart ? ', then restart the session' : ''
  return `committed Lumo install behind lumo ${cliVersion}: ${what} — run ${cmds.join(' and ')}, then commit the changes in a PR${then}`
}

/**
 * LUM-1235 — the segment for an uncommitted settings file still holding
 * retired Lumo hooks: the file, the events and `lumo init --project`, which
 * strips them. Nothing to commit, so no PR step. Null when there is none.
 */
export function retiredHooksNote(
  items: readonly ProjectDriftItem[]
): string | null {
  const item = items.find(i => i.kind === 'claude-settings-retired')
  if (!item) return null
  const events = (item.retiredEvents ?? []).join(', ')
  return `uncommitted ${item.relPath} still has retired Lumo hooks (${events}) that break Claude Code worktrees — run \`lumo init --project --agent ${item.agent}\` (preview with \`--dry-run\`) to remove them`
}

const NOTED_FILE = 'session-project-install-notes.json'
/** Sessions remembered; the oldest are dropped. */
const MAX_SESSIONS = 200
/** A held lock older than this is treated as abandoned. */
const LOCK_STALE_MS = 10_000

export function projectNotesPath(configDir: string): string {
  return path.join(configDir, NOTED_FILE)
}

function readNoted(file: string): string[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

/** Whether this session already got the reminder (read-only, no lock). */
export function alreadyNoted(file: string, sessionId: string): boolean {
  return readNoted(file).includes(sessionId)
}

/**
 * Record that `sessionId` got the reminder. Returns false — say nothing —
 * when another hook holds the lock, the session is already recorded, or the
 * write fails, so the reminder is never shown twice for one session.
 */
export function markNoted(file: string, sessionId: string): boolean {
  const lock = `${file}.lock`
  try {
    if (!acquireFileLock(lock, LOCK_STALE_MS)) return false
  } catch {
    return false
  }
  try {
    const seen = readNoted(file)
    if (seen.includes(sessionId)) return false
    seen.push(sessionId)
    const kept = seen.slice(Math.max(0, seen.length - MAX_SESSIONS))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(kept) + '\n')
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  } finally {
    try {
      releaseFileLock(lock)
    } catch {
      // best effort
    }
  }
}

/**
 * The drift for this SessionStart, or [] when there is none or this session
 * was already reminded. Without a session id there is nothing to dedupe on,
 * so the reminder is shown. Never throws.
 */
export function projectDriftOnce(opts: {
  cwd: string
  cliVersion: string
  sessionId: string | null
  notedFile: string
}): ProjectDriftItem[] {
  try {
    if (opts.sessionId && alreadyNoted(opts.notedFile, opts.sessionId))
      return []
    const items = projectInstallDrift(opts)
    if (items.length === 0) return []
    if (opts.sessionId && !markNoted(opts.notedFile, opts.sessionId)) return []
    return items
  } catch {
    return []
  }
}
