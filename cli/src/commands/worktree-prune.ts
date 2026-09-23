import * as path from 'path'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { matchTaskIdentifier } from '../lib/git-task'
import {
  getMainRoot,
  gitOutput,
  parseWorktreePorcelain,
  type WorktreeEntry,
} from '../lib/worktree'
import {
  assessWorktree,
  describeWorktreeCleanup,
  fetchCleanupInfo,
  removeWorktrees,
  reportRemoval,
  type CleanupItem,
} from '../lib/worktree-cleanup'

/** `<TEAM>-N` from a worktree's dir basename or branch, else null. */
function taskIdOf(entry: WorktreeEntry): string | null {
  return (
    matchTaskIdentifier(path.basename(entry.path)) ??
    (entry.branch ? matchTaskIdentifier(entry.branch) : null)
  )
}

/**
 * `lumo worktree prune` (LUM-825): remove the worktrees of tasks that are
 * already DONE — the catch-all for tasks closed on the web or on another
 * machine, where the DONE-time cleanup never ran locally. Same safety rules
 * as that cleanup (see lib/worktree-cleanup.ts): dirty, unlanded, or
 * containing the current directory → kept, with the reason. Tasks that are
 * not DONE, or that cannot be looked up, are left alone.
 */
export async function worktreePrune(opts: ConfirmFlags): Promise<number> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))

  let mainRoot: string
  try {
    mainRoot = getMainRoot()
  } catch {
    console.error('Error: not inside a git repository')
    return 1
  }
  const byTask = new Map<string, WorktreeEntry[]>()
  for (const e of parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  )) {
    if (path.resolve(e.path) === path.resolve(mainRoot)) continue
    const id = taskIdOf(e)
    if (!id) continue
    byTask.set(id, [...(byTask.get(id) ?? []), e])
  }

  const cwd = process.cwd()
  const items: Array<CleanupItem & { taskId: string }> = []
  let skipped = 0
  let unknown = 0
  for (const [taskId, entries] of byTask) {
    const info = await fetchCleanupInfo(base, creds.token, taskId)
    if (!info) {
      unknown += entries.length
      continue
    }
    if (info.status !== 'DONE') {
      skipped += entries.length
      continue
    }
    for (const e of entries) {
      items.push({
        ...assessWorktree(e, { cwd, mergedHeadShas: info.mergedHeadShas }),
        taskId,
      })
    }
  }

  const footer: string[] = []
  if (skipped > 0) {
    footer.push(
      `${skipped} worktree(s) of tasks that are not DONE are left alone`
    )
  }
  if (unknown > 0) {
    footer.push(
      `${unknown} worktree(s) whose task could not be looked up are left alone`
    )
  }

  if (!items.some(i => i.removable)) {
    console.log('Nothing to prune: no removable worktrees of DONE tasks.')
    for (const line of describeWorktreeCleanup(items, mainRoot)) {
      console.log(`  ${line}`)
    }
    for (const line of footer) console.log(`  ${line}`)
    return 0
  }

  if (!isConfirmed(opts)) {
    return emitConfirmation({
      command: 'worktree prune',
      changes: [
        ...items.map(
          i =>
            `${i.taskId} (DONE): ${describeWorktreeCleanup([i], mainRoot)[0]}`
        ),
        ...footer,
      ],
    })
  }

  reportRemoval(items, removeWorktrees(mainRoot, items), mainRoot)
  for (const line of footer) console.log(`  ${line}`)
  return 0
}
