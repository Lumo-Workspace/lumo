import { NONE } from '../lib/format'
import * as fs from 'fs'
import * as path from 'path'
import {
  getGitCommonDir,
  gitOutput,
  parseWorktreePorcelain,
} from '../lib/worktree'
import { matchTaskIdentifier } from '../lib/git-task'
import { emitJson, listEnvelope } from '../lib/json-output'

function nodeModulesLinked(dir: string): boolean {
  try {
    return fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
  } catch {
    return false
  }
}

/** Pull a `<TEAM>-N` id from a worktree dir basename or its branch, else `-`. */
function taskIdOf(dirBase: string, branch: string | null): string {
  return (
    matchTaskIdentifier(dirBase) ??
    (branch ? matchTaskIdentifier(branch) : null) ??
    NONE
  )
}

export interface WorktreeRow {
  /** `<TEAM>-N` from the directory name or branch; null when neither has one. */
  task: string | null
  /** Null for a detached HEAD. */
  branch: string | null
  dirty: boolean
  /** Null outside a repo that has a node_modules to link. */
  nodeModulesLinked: boolean | null
  path: string
}

/** One row per worktree under `.worktrees/` (read from git and the disk). */
export function worktreeRows(): WorktreeRow[] {
  const mainRoot = path.dirname(getGitCommonDir())
  const worktreesDir = path.join(mainRoot, '.worktrees')
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  ).filter(e => e.path.startsWith(worktreesDir + path.sep))
  // LUM-825: the link column only means something in a repo that has a
  // node_modules to link — elsewhere "MISSING" would be noise.
  const nodeRepo = fs.existsSync(path.join(mainRoot, 'node_modules'))
  return entries.map(e => {
    const id = taskIdOf(path.basename(e.path), e.branch)
    return {
      task: id === NONE ? null : id,
      branch: e.branch,
      dirty: gitOutput(['status', '--porcelain'], e.path).length > 0,
      nodeModulesLinked: nodeRepo ? nodeModulesLinked(e.path) : null,
      path: e.path,
    }
  })
}

export async function worktreeList(
  opts: { json?: boolean } = {}
): Promise<number> {
  const rows = worktreeRows()
  if (opts.json) {
    emitJson(listEnvelope('worktrees', rows))
    return 0
  }
  if (rows.length === 0) {
    console.log('No worktrees under .worktrees/.')
    return 0
  }
  for (const r of rows) {
    const nm =
      r.nodeModulesLinked === null
        ? ''
        : `\tnode_modules:${r.nodeModulesLinked ? 'linked' : 'MISSING'}`
    console.log(
      `${r.task ?? NONE}\t${r.branch ?? '(detached)'}\t${r.dirty ? 'dirty' : 'clean'}${nm}\t${r.path}`
    )
  }
  return 0
}
