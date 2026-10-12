import { NONE } from '../lib/format'
import * as fs from 'fs'
import * as path from 'path'
import {
  getGitCommonDir,
  gitOutput,
  parseWorktreePorcelain,
} from '../lib/worktree'
import { matchTaskIdentifier } from '../lib/git-task'

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

export async function worktreeList(): Promise<number> {
  const mainRoot = path.dirname(getGitCommonDir())
  const worktreesDir = path.join(mainRoot, '.worktrees')
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  ).filter(e => e.path.startsWith(worktreesDir + path.sep))

  if (entries.length === 0) {
    console.log('No worktrees under .worktrees/.')
    return 0
  }

  // LUM-825: the link column only means something in a repo that has a
  // node_modules to link — elsewhere "MISSING" would be noise.
  const nodeRepo = fs.existsSync(path.join(mainRoot, 'node_modules'))
  for (const e of entries) {
    const base = path.basename(e.path)
    const id = taskIdOf(base, e.branch)
    const dirty =
      gitOutput(['status', '--porcelain'], e.path).length > 0
        ? 'dirty'
        : 'clean'
    const nm = nodeRepo
      ? `\tnode_modules:${nodeModulesLinked(e.path) ? 'linked' : 'MISSING'}`
      : ''
    console.log(`${id}\t${e.branch ?? '(detached)'}\t${dirty}${nm}\t${e.path}`)
  }
  return 0
}
