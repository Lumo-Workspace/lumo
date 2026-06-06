import {
  normalizeTaskId,
  isMainCheckout,
  getRepoRoot,
  gitOutput,
  runGit,
  parseWorktreePorcelain,
  findWorktreeByTaskId,
} from '../lib/worktree'

export interface WorktreeRmOptions {
  yes?: boolean | undefined
  force?: boolean | undefined
  deleteBranch?: boolean | undefined
}

export async function worktreeRm(
  rawId: string,
  opts: WorktreeRmOptions
): Promise<number> {
  const taskId = normalizeTaskId(rawId)
  if (!taskId) {
    console.error(`Error: "${rawId}" is not a task id (expected LUM-N or N)`)
    return 1
  }
  if (!isMainCheckout()) {
    console.error(
      'Error: run `lumo worktree rm` from the main checkout, not inside a worktree'
    )
    return 1
  }

  const root = getRepoRoot()
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], root)
  )
  const target = findWorktreeByTaskId(entries, taskId)
  if (!target) {
    console.error(`Error: no worktree found for ${taskId}`)
    return 1
  }
  if (!opts.yes) {
    console.error(
      `Error: refusing to remove ${target.path} without --yes (destructive)`
    )
    return 1
  }

  const dirty = gitOutput(['status', '--porcelain'], target.path).length > 0
  if (dirty && !opts.force) {
    console.error(
      `Error: ${target.path} has uncommitted changes — pass --force to remove anyway`
    )
    return 1
  }

  const removeArgs =
    dirty && opts.force
      ? ['worktree', 'remove', '--force', target.path]
      : ['worktree', 'remove', target.path]
  const removed = runGit(removeArgs, root)
  if (removed.status !== 0) {
    console.error(
      `Error: ${(removed.stderr || '').trim() || 'git worktree remove failed'}`
    )
    return 1
  }
  console.log(`✓ Removed worktree ${target.path}`)

  if (opts.deleteBranch && target.branch) {
    const del = runGit(['branch', '-d', target.branch], root)
    if (del.status !== 0) {
      console.error(
        `Warning: could not delete branch ${target.branch}: ${(del.stderr || '').trim()}`
      )
    } else {
      console.log(`✓ Deleted branch ${target.branch}`)
    }
  } else if (target.branch) {
    console.log(
      `  branch ${target.branch} kept (use --delete-branch to remove)`
    )
  }

  return 0
}
