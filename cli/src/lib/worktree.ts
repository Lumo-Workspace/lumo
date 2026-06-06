/**
 * Normalize a user-supplied task reference to canonical `LUM-<n>` form.
 * Accepts `LUM-267`, `lum-267`, and bare `267`. Returns null for anything
 * that is not a recognizable task id.
 */
export function normalizeTaskId(input: string): string | null {
  const trimmed = input.trim()
  const prefixed = trimmed.match(/^lum-?(\d+)$/i)
  if (prefixed) return `LUM-${prefixed[1]}`
  const bare = trimmed.match(/^(\d+)$/)
  if (bare) return `LUM-${bare[1]}`
  return null
}

/**
 * Turn an arbitrary human slug into a branch/dir-safe segment: lowercase,
 * non-alphanumeric runs collapse to a single dash, leading/trailing dashes
 * stripped.
 */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `lumo/LUM-267` or `lumo/LUM-267-<slug>`. */
export function deriveBranchName(taskId: string, slug?: string): string {
  const s = slug ? slugify(slug) : ''
  return s ? `lumo/${taskId}-${s}` : `lumo/${taskId}`
}

/** `.worktrees/` dir basename: `LUM-267` or `LUM-267-<slug>`. */
export function deriveWorktreeDirName(taskId: string, slug?: string): string {
  const s = slug ? slugify(slug) : ''
  return s ? `${taskId}-${s}` : taskId
}

import * as path from 'path'

export interface WorktreeEntry {
  path: string
  head: string
  /** Short branch name (no `refs/heads/`), or null when detached. */
  branch: string | null
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 * Records are separated by blank lines; a detached worktree has a `detached`
 * line instead of `branch`. Tolerates a final record with no trailing blank.
 */
export function parseWorktreePorcelain(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let cur: { path: string; head: string; branch: string | null } | null = null
  const flush = () => {
    if (cur) entries.push(cur)
    cur = null
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      cur = { path: line.slice('worktree '.length), head: '', branch: null }
    } else if (!cur) {
      continue
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === '') {
      flush()
    }
  }
  flush()
  return entries
}

/**
 * Find the worktree belonging to a task id. Matches either the branch
 * (`lumo/LUM-267` exactly or `lumo/LUM-267-*`) or the directory basename
 * (`LUM-267` exactly or `LUM-267-*`).
 */
export function findWorktreeByTaskId(
  entries: WorktreeEntry[],
  taskId: string
): WorktreeEntry | null {
  return (
    entries.find(e => {
      const base = path.basename(e.path)
      const branchMatch =
        e.branch === `lumo/${taskId}` ||
        (e.branch?.startsWith(`lumo/${taskId}-`) ?? false)
      const dirMatch = base === taskId || base.startsWith(`${taskId}-`)
      return branchMatch || dirMatch
    }) ?? null
  )
}

import { spawnSync, type SpawnSyncReturns } from 'child_process'

/** Low-level git runner — returns the raw spawn result, never throws on exit. */
export function runGit(
  args: string[],
  cwd?: string
): SpawnSyncReturns<string> {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

/** Run git and return trimmed stdout; throw with stderr on failure. */
export function gitOutput(args: string[], cwd?: string): string {
  const r = runGit(args, cwd)
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error((r.stderr || '').trim() || `git ${args.join(' ')} failed`)
  }
  return (r.stdout ?? '').trim()
}

/** Absolute path to the worktree-local `.git` (file or dir). */
export function getGitDir(cwd?: string): string {
  return gitOutput(['rev-parse', '--absolute-git-dir'], cwd)
}

/** Absolute path to the shared `.git` (same as git-dir in the main checkout). */
export function getGitCommonDir(cwd?: string): string {
  const common = gitOutput(['rev-parse', '--git-common-dir'], cwd)
  return path.resolve(cwd ?? process.cwd(), common)
}

/** True only in the main checkout (git-dir === common-dir). */
export function isMainCheckout(cwd?: string): boolean {
  return getGitDir(cwd) === getGitCommonDir(cwd)
}

/** Absolute repo root of the current working tree. */
export function getRepoRoot(cwd?: string): string {
  return gitOutput(['rev-parse', '--show-toplevel'], cwd)
}
