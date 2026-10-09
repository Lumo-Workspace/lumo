import { spawnSync } from 'child_process'
import * as path from 'path'

/** Run git in `cwd`; trimmed stdout, or null on any failure. */
export function gitCapture(cwd: string, args: string[]): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (res.error || res.status !== 0) return null
  return res.stdout.trim()
}

export interface GitHooksDir {
  /** Absolute hooks directory, or null when it could not be resolved. */
  dir: string | null
  /** `core.hooksPath` when set (husky or a custom dir), else null. */
  coreHooksPath: string | null
}

/**
 * Resolve where git runs hooks from for the repo at `projectRoot` via
 * `git rev-parse --git-path hooks` (correct inside linked worktrees too).
 * `coreHooksPath` is reported separately so callers can degrade.
 */
export function resolveGitHooksDir(projectRoot: string): GitHooksDir {
  const coreHooksPath =
    gitCapture(projectRoot, ['config', 'core.hooksPath']) || null
  // --git-path already honours core.hooksPath (incl. `~` expansion and
  // relative paths), so it is the single source of truth for the directory.
  const raw = gitCapture(projectRoot, ['rev-parse', '--git-path', 'hooks'])
  if (!raw) return { dir: null, coreHooksPath }
  return {
    dir: path.isAbsolute(raw) ? raw : path.join(projectRoot, raw),
    coreHooksPath,
  }
}
