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
import { isPathGitTracked, repoRoot } from './repo-root'
import { classifySkillStub, skillStubAgent, skillStubPaths } from './skill-stub'

/**
 * LUM-1108 — the committed (git-tracked) Lumo install of the current repo
 * that is behind the running CLI: `.claude/settings.json` hooks,
 * `.codex/hooks.json`, `.codex/rules/lumo.rules` and the frozen skill stubs. Nothing rewrites these
 * on its own (they are shared with the team through git), so the
 * SessionStart status line names them once per session with the fix command.
 * The decisions are the ones `lumo init` acts on. Purely local and read-only; every entry point swallows its failures.
 *
 * Two exceptions to "committed only": an uncommitted `.claude/settings.json`
 * that still holds Lumo entries for events the CLI no longer registers (an old
 * WorktreeCreate hook breaks every Claude Code worktree) counts as drifted
 * too — nothing else would point at it; and an outdated
 * `.codex/rules/lumo.rules` is reported tracked or not (security: the rules
 * decide which `lumo` commands run outside Codex's sandbox, and an old file
 * fails open for newer commands). Each item carries `tracked` so the note
 * words the fix accordingly.
 */

export type ProjectDriftKind =
  | 'claude-settings'
  | 'codex-hooks'
  | 'codex-rules'
  | 'skill-stub'

export interface ProjectDriftItem {
  kind: ProjectDriftKind
  /** Absolute path. */
  path: string
  /** Path relative to the repo root, for the reminder. */
  relPath: string
  /** Agent token the install belongs to (the `--agent` of its refresh). */
  agent: string
  /** Whether git tracks the file (shared with the team) or it is local only. */
  tracked: boolean
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
  const tracked = (file: string): boolean =>
    safe(() => isPathGitTracked(file), false)
  const add = (kind: ProjectDriftKind, file: string, agent: string): void => {
    items.push({
      kind,
      path: file,
      relPath: path.relative(root, file),
      agent,
      tracked: tracked(file),
    })
  }

  const behindAndTracked = (file: string, behind: () => boolean): boolean =>
    safe(behind, false) && safe(() => isPathGitTracked(file), false)

  const settings = safe(() => projectClaudeSettingsTarget(root), null)
  if (
    settings &&
    safe(() => planHooksMerge(settings.path, settings.agent).writes, false) &&
    (tracked(settings.path) ||
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
  if (rules && safe(() => classifyCodexRules(rules) === 'outdated', false))
    add('codex-rules', rules, 'codex')

  // The frozen skill stub (`/lumo`): reported, tracked or not, when it is
  // missing or differs — but only for an agent whose Lumo install is here.
  const have: Record<string, boolean> = {
    'claude-code': settings !== null,
    codex: safe(() => hasLumoCodexHooks(codexHooks), false) || rules !== null,
  }
  for (const file of skillStubPaths(root)) {
    const agent = skillStubAgent(root, file)
    if (have[agent] && safe(() => classifySkillStub(file) !== 'current', false))
      add('skill-stub', file, agent)
  }

  return items
}

/**
 * One status-line segment naming what is behind and how to fix it: re-run
 * `lumo init` (narrowed with `--agent` when everything belongs to one agent),
 * previewed with `--dry-run`. The result is uncommitted: open a PR.
 */
export function projectDriftNote(
  items: readonly ProjectDriftItem[],
  cliVersion: string
): string | null {
  if (items.length === 0) return null
  const what = items.map(i => i.relPath).join(', ')
  const agents = [...new Set(items.map(i => i.agent))]
  const init = `lumo init${agents.length === 1 ? ` --agent ${agents[0]}` : ''}`
  const rulesWarning = items.some(i => i.kind === 'codex-rules')
    ? ' (an outdated rules file may let newer lumo commands run outside the sandbox)'
    : ''
  // Untracked files are local only: there is no PR to open for them.
  const anyTracked = items.some(i => i.tracked)
  const tail = anyTracked ? ', then commit the changes in a PR' : ''
  return `${anyTracked ? 'committed' : 'local'} Lumo install behind lumo ${cliVersion}: ${what} — run \`${init}\` (preview with \`--dry-run\`)${tail}${rulesWarning}`
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
