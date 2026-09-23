/**
 * Normalize a user-supplied task reference to canonical `<TEAM>-<n>` form.
 * Accepts any team prefix (`LUM-267`, `SPEC-12`, `spec-12`), not just LUM —
 * the prefix is a team's configured identifier (1–10 letters), matching the
 * single-sourced shape in shared/src/task-identifier.ts (LUM-419). The prefix
 * is upper-cased; the number is preserved.
 *
 * A bare number (`267`) returns null here: without team context the prefix
 * cannot be inferred locally. Team-aware bare-number resolution (via the
 * workspace's default team) lives in `resolveWorktreeTaskId` (worktree-ref.ts).
 */
export function normalizeTaskId(input: string): string | null {
  const m = input.trim().match(/^([A-Za-z]{1,10})-(\d+)$/)
  if (!m) return null
  return `${m[1]!.toUpperCase()}-${m[2]}`
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

import * as fs from 'fs'
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
export function runGit(args: string[], cwd?: string): SpawnSyncReturns<string> {
  // 120s is a safety net against a genuine hang (e.g. an index.lock deadlock),
  // NOT a tight bound: this wrapper runs legitimately-slow ops like `git fetch`
  // and `git worktree add`, which must not be killed prematurely. On timeout
  // spawnSync populates `r.error`, which gitOutput already rethrows.
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120_000 })
}

/**
 * Run git and return trimmed stdout; THROWS with stderr on non-zero exit or
 * spawn error. NOTE: unlike the same-named `gitOutput` in `cli/src/lib/git-task.ts`
 * (which swallows failures and returns `''`), this one surfaces failures by
 * throwing — callers must handle/expect the throw.
 */
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

/**
 * Every worktree belonging to a task, excluding the main checkout (a main
 * checkout that happens to sit on `lumo/LUM-N` is not a task worktree and
 * must never be offered for removal). Same match rule as
 * `findWorktreeByTaskId`; callers that act on "the" worktree should list all
 * candidates rather than silently pick one.
 */
export function findWorktreesByTaskId(
  entries: WorktreeEntry[],
  taskId: string,
  mainRoot: string
): WorktreeEntry[] {
  const main = path.resolve(mainRoot)
  return entries.filter(
    e =>
      path.resolve(e.path) !== main &&
      findWorktreeByTaskId([e], taskId) !== null
  )
}

/** Absolute path of the main checkout, from any worktree of the repo. */
export function getMainRoot(cwd?: string): string {
  return path.dirname(getGitCommonDir(cwd))
}

function remoteBranchExists(root: string, name: string): boolean {
  return (
    runGit(
      ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`],
      root
    ).status === 0
  )
}

function readOriginHead(root: string): string | null {
  const r = runGit(
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    root
  )
  if (r.status !== 0) return null
  const ref = (r.stdout ?? '').trim()
  return ref.startsWith('origin/') ? ref.slice('origin/'.length) : null
}

/**
 * The remote's default branch name (`main`, `master`, `develop`, …) — never
 * assumed. Order: the local `origin/HEAD` symref; then, when the network is
 * allowed, `git remote set-head origin --auto` (asks the remote) and re-read;
 * then a local probe for `origin/main` / `origin/master`. Null when nothing
 * answers (no remote, or an unusual layout) — the caller asks for `--base`.
 */
export function detectDefaultBranch(
  root: string,
  opts: { allowNetwork: boolean }
): string | null {
  const local = readOriginHead(root)
  if (local) return local
  if (opts.allowNetwork) {
    if (runGit(['remote', 'set-head', 'origin', '--auto'], root).status === 0) {
      const asked = readOriginHead(root)
      if (asked) return asked
    }
  }
  for (const name of ['main', 'master']) {
    if (remoteBranchExists(root, name)) return name
  }
  return null
}

/**
 * `core.hooksPath` when it points into `.husky/` (husky v9 sets `.husky/_`),
 * else null. Only then does a fresh worktree need the untracked shim copied
 * in: plain `.git/hooks` live in the shared common dir and already fire in
 * every worktree.
 */
export function huskyHooksPath(root: string): string | null {
  const r = runGit(['config', '--get', 'core.hooksPath'], root)
  if (r.status !== 0) return null
  const value = (r.stdout ?? '').trim().replace(/^\.\//, '')
  return value === '.husky' || value.startsWith('.husky/') ? value : null
}

/**
 * Make sure `.worktrees/` never shows up as untracked in the main checkout.
 * A repo whose .gitignore already covers it is left alone; otherwise the
 * pattern goes into `.git/info/exclude` — local to this clone, so the
 * customer's tracked .gitignore is never touched. Returns true when it wrote.
 */
export function ensureWorktreesExcluded(root: string): boolean {
  const ignored =
    runGit(['check-ignore', '-q', '.worktrees/probe'], root).status === 0
  if (ignored) return false
  const excludeFile = path.join(getGitCommonDir(root), 'info', 'exclude')
  let current = ''
  try {
    current = fs.readFileSync(excludeFile, 'utf8')
  } catch {
    // no exclude file yet
  }
  const sep = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true })
  fs.writeFileSync(
    excludeFile,
    `${current}${sep}# lumo worktree (LUM-825)\n/.worktrees/\n`
  )
  return true
}
