import {
  isMainCheckout,
  getRepoRoot,
  gitOutput,
  runGit,
  parseWorktreePorcelain,
  findWorktreesByTaskId,
} from '../lib/worktree'
import { resolveWorktreeTaskId } from '../lib/worktree-ref'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export interface WorktreeRmOptions extends ConfirmFlags {
  force?: boolean | undefined
  deleteBranch?: boolean | undefined
}

/**
 * The changes[] block for the confirmation envelope. `dirty` adds the
 * discard warning that --force acknowledges; `deleteBranch` flips the branch
 * line from "kept" to "deleted".
 */
export function describeWorktreeRm(args: {
  path: string
  branch: string | null
  dirty: boolean
  deleteBranch: boolean
}): string[] {
  const lines = [
    `Will remove worktree ${args.path}${args.branch ? ` (branch ${args.branch})` : ''}`,
  ]
  if (args.dirty) {
    lines.push(
      '⚠ The worktree has uncommitted changes — they will be discarded (--force acknowledges this)'
    )
  }
  if (args.branch) {
    lines.push(
      args.deleteBranch
        ? `Branch ${args.branch} will be deleted too (--delete-branch; git refuses an unmerged branch)`
        : `Branch ${args.branch} is kept (pass --delete-branch to delete it)`
    )
  }
  return lines
}

export async function worktreeRm(
  rawId: string,
  opts: WorktreeRmOptions
): Promise<number> {
  let taskId: string | null
  try {
    taskId = await resolveWorktreeTaskId(rawId)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (!taskId) {
    console.error(
      `Error: "${rawId}" is not a task id (expected <TEAM>-N like LUM-42 or SPEC-12, or a bare number)`
    )
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
  const matches = findWorktreesByTaskId(entries, taskId, root)
  if (matches.length === 0) {
    console.error(`Error: no worktree found for ${taskId}`)
    return 1
  }
  // LUM-825: never pick one silently — name them all and let the user choose.
  if (matches.length > 1) {
    console.error(
      `Error: ${matches.length} worktrees match ${taskId}; remove the one you mean by path:`
    )
    for (const m of matches) {
      console.error(
        `  git worktree remove ${m.path}   (${m.branch ?? 'detached'})`
      )
    }
    return 1
  }
  const target = matches[0]!

  const dirty = gitOutput(['status', '--porcelain'], target.path).length > 0

  // LUM-755: two gates, one envelope. Missing --confirm, or a dirty tree
  // without --force, both stop here with the same structured refusal; the
  // confirmCommand carries whichever flags are still missing.
  if (!isConfirmed(opts) || (dirty && !opts.force)) {
    return emitConfirmation({
      command: 'worktree rm',
      changes: describeWorktreeRm({
        path: target.path,
        branch: target.branch ?? null,
        dirty,
        deleteBranch: Boolean(opts.deleteBranch),
      }),
      extraFlags: dirty ? ['--force'] : [],
    })
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
