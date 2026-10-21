import * as fs from 'fs'
import * as path from 'path'
import { codexHooksPath } from './codex-hooks'
import { classifyCodexRules } from './codex-rules'
import { acquireFileLock, releaseFileLock } from './file-lock'
import { CODEX_HOOK_EVENTS, staleLumoHookEvents } from './hooks-template'
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
 * The decisions are the ones `lumo skill update` / `lumo init --scope project`
 * act on. Purely local and read-only; every entry point swallows its failures.
 *
 * One exception to "committed only": an uncommitted `.claude/settings.json`
 * that still holds Lumo entries for events the CLI no longer registers (an old
 * WorktreeCreate hook breaks every Claude Code worktree) counts as drifted
 * too — nothing else would point at it.
 */

export type ProjectDriftKind =
  | 'skill'
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-rules'

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
    safe(() => planHooksMerge(settings.path, settings.agent).writes, false) &&
    (safe(() => isPathGitTracked(settings.path), false) ||
      safe(
        () =>
          staleLumoHookEvents(
            (
              JSON.parse(fs.readFileSync(settings.path, 'utf8')) as {
                hooks?: unknown
              }
            ).hooks
          ).length > 0,
        false
      ))
  )
    add('claude-settings', settings.path, settings.agent)

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
 * copies → `lumo skill update --scope project` (never touches hooks, so Codex keeps
 * its trust); hooks / rules → re-run `lumo init --scope project` (narrowed with
 * `--agent` when they all belong to one agent), previewed with `--dry-run`.
 * Either way the result is uncommitted: open a PR. `restart` adds the
 * restart step when the session's own skill copy is among them.
 */
export function projectDriftNote(
  items: readonly ProjectDriftItem[],
  cliVersion: string,
  opts: { restart?: boolean } = {}
): string | null {
  if (items.length === 0) return null
  const what = items
    .map(i => (i.version ? `${i.relPath} ${i.version}` : i.relPath))
    .join(', ')
  const cmds: string[] = []
  if (items.some(i => i.kind === 'skill'))
    cmds.push('`lumo skill update --scope project`')
  const hooks = items.filter(i => i.kind !== 'skill')
  if (hooks.length > 0) {
    const agents = [...new Set(hooks.map(i => i.agent))]
    const init = `lumo init --scope project${agents.length === 1 ? ` --agent ${agents[0]}` : ''}`
    cmds.push(`\`${init}\` (preview with \`--dry-run\`)`)
  }
  const then = opts.restart ? ', then restart the session' : ''
  const rulesWarning = items.some(i => i.kind === 'codex-rules')
    ? ' (an outdated rules file may let newer lumo commands run outside the sandbox)'
    : ''
  return `committed Lumo install behind lumo ${cliVersion}: ${what} — run ${cmds.join(' and ')}, then commit the changes in a PR${then}${rulesWarning}`
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
