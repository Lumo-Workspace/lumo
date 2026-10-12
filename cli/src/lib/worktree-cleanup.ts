import * as path from 'path'
import {
  findWorktreesByTaskId,
  getMainRoot,
  gitOutput,
  parseWorktreePorcelain,
  type WorktreeEntry,
} from './worktree'
import {
  describeResidue,
  removeWorktreeDir,
  type WorktreeResidue,
} from './worktree-remove'
import { warn } from './errors'

/**
 * Safe worktree cleanup for finished tasks (LUM-825) — shared by the DONE
 * transition (`task update --status done`) and `lumo worktree prune`.
 *
 * A worktree is removable only when nothing in it can be lost:
 *   - no uncommitted or untracked changes (`git status --porcelain` empty);
 *   - every commit on its HEAD is either on some remote ref, or HEAD is
 *     exactly the head commit of a merged linked PR. The second rule is what
 *     makes squash-merged branches removable once their remote branch is
 *     gone — while a commit added after the merge (HEAD ≠ merged head) still
 *     keeps the worktree;
 *   - the current directory is not inside it (removing the shell's own cwd
 *     breaks every later command in that session).
 * Removal never uses --force, and branches are never deleted here. Once git
 * has unregistered a worktree, whatever a still-running process wrote into
 * it during the delete is finished off; anything that still cannot go is
 * reported with a one-line cleanup command (LUM-971, see worktree-remove.ts).
 */

export type KeepReason = 'dirty' | 'unlanded' | 'cwd'

export interface CleanupItem {
  path: string
  branch: string | null
  removable: boolean
  reason?: KeepReason
  /** Human detail for a kept worktree (e.g. "2 commits not pushed"). */
  detail?: string
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Assess one worktree against the three keep rules, in priority order. */
export function assessWorktree(
  entry: WorktreeEntry,
  ctx: { cwd: string; mergedHeadShas: string[] }
): CleanupItem {
  const base = { path: entry.path, branch: entry.branch }
  if (isInside(ctx.cwd, entry.path)) {
    return {
      ...base,
      removable: false,
      reason: 'cwd',
      detail: 'the current directory is inside it',
    }
  }
  if (
    gitOutput(['--no-optional-locks', 'status', '--porcelain'], entry.path)
      .length > 0
  ) {
    return {
      ...base,
      removable: false,
      reason: 'dirty',
      detail: 'it has uncommitted changes',
    }
  }
  const unpushed = Number(
    gitOutput(['rev-list', '--count', 'HEAD', '--not', '--remotes'], entry.path)
  )
  if (unpushed > 0) {
    const head = gitOutput(['rev-parse', 'HEAD'], entry.path)
    if (!ctx.mergedHeadShas.includes(head)) {
      return {
        ...base,
        removable: false,
        reason: 'unlanded',
        detail: `${unpushed} commit${unpushed === 1 ? '' : 's'} not pushed and HEAD is not the head of a merged linked PR`,
      }
    }
  }
  return { ...base, removable: true }
}

/** The task's worktrees (never the main checkout), assessed. */
export function planTaskWorktreeCleanup(args: {
  taskId: string
  cwd: string
  mergedHeadShas: string[]
}): { mainRoot: string; items: CleanupItem[] } | null {
  let mainRoot: string
  try {
    mainRoot = getMainRoot(args.cwd)
  } catch {
    return null // not in a git repo
  }
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  )
  const items = findWorktreesByTaskId(entries, args.taskId, mainRoot).map(e =>
    assessWorktree(e, args)
  )
  return { mainRoot, items }
}

/** Envelope lines: one per worktree — removed, or kept with its reason. */
export function describeWorktreeCleanup(
  items: CleanupItem[],
  mainRoot: string
): string[] {
  return items.map(item => {
    const branch = item.branch ? ` (branch ${item.branch} kept)` : ''
    if (item.removable) return `Will remove worktree ${item.path}${branch}`
    const later =
      item.reason === 'cwd'
        ? ` — remove it later from elsewhere: git -C ${mainRoot} worktree remove ${item.path}`
        : ''
    return `Keeps worktree ${item.path}: ${item.detail}${later}`
  })
}

/**
 * Remove the removable items (plain `git worktree remove`, never --force).
 * `failed` = git refused and the worktree is intact; `residue` = git
 * unregistered it but part of the directory could not be deleted.
 */
export function removeWorktrees(
  mainRoot: string,
  items: CleanupItem[]
): {
  removed: string[]
  failed: Array<{ path: string; error: string }>
  residue: Array<{ path: string; residue: WorktreeResidue }>
} {
  const removed: string[] = []
  const failed: Array<{ path: string; error: string }> = []
  const residue: Array<{ path: string; residue: WorktreeResidue }> = []
  for (const item of items) {
    if (!item.removable) continue
    const r = removeWorktreeDir(mainRoot, item.path)
    if (r.status === 'removed') removed.push(item.path)
    else if (r.status === 'refused')
      failed.push({ path: item.path, error: r.error })
    else residue.push({ path: item.path, residue: r.residue })
  }
  return { removed, failed, residue }
}

/** The slice of a task the cleanup needs from `GET /api/tasks/by-identifier`. */
export interface CleanupTaskInfo {
  status: string
  mergedHeadShas: string[]
}

/**
 * Look a task up for cleanup. Returns null on any failure (404, network,
 * auth) — callers treat "unknown" as "leave the worktree alone".
 */
export async function fetchCleanupInfo(
  base: string,
  token: string,
  identifier: string
): Promise<CleanupTaskInfo | null> {
  try {
    const res = await fetch(
      `${base}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return null
    const { task } = (await res.json()) as {
      task: {
        status: string
        pullRequests?: Array<{ state: string | null; headSha?: string | null }>
      }
    }
    return {
      status: task.status,
      mergedHeadShas: mergedHeadShasOf(task.pullRequests ?? []),
    }
  } catch {
    return null
  }
}

/**
 * Head commits of the task's merged PRs. `headSha` is absent on servers
 * older than LUM-825 — then the list is empty and only the "pushed" rule
 * applies, which only ever keeps more worktrees, never fewer.
 */
export function mergedHeadShasOf(
  prs: Array<{ state: string | null; headSha?: string | null }>
): string[] {
  return prs
    .filter(pr => pr.state === 'merged' && typeof pr.headSha === 'string')
    .map(pr => pr.headSha as string)
}

/** Print the outcome of a removal pass (shared by DONE and prune). */
export function reportRemoval(
  items: CleanupItem[],
  result: ReturnType<typeof removeWorktrees>,
  mainRoot: string
): void {
  for (const p of result.removed) console.log(`✓ Removed worktree ${p}`)
  for (const f of result.failed) {
    console.error(warn(`could not remove worktree ${f.path}: ${f.error}`))
  }
  for (const r of result.residue) {
    for (const line of describeResidue(r.path, r.residue)) console.error(line)
  }
  for (const line of describeWorktreeCleanup(
    items.filter(i => !i.removable),
    mainRoot
  )) {
    console.log(`  ${line}`)
  }
}
