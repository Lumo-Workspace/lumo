import * as fs from 'fs'
import * as path from 'path'
import {
  getGitCommonDir,
  gitOutput,
  parseWorktreePorcelain,
  normalizeTaskId,
} from '../lib/worktree'

function nodeModulesLinked(dir: string): boolean {
  try {
    return fs.lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()
  } catch {
    return false
  }
}

/** Pull a LUM-N from a worktree dir basename or its branch, else '—'. */
function taskIdOf(dirBase: string, branch: string | null): string {
  return (
    normalizeTaskId(dirBase.replace(/-.*$/, '')) ??
    (branch ? normalizeTaskId(branch.replace(/^lumo\//, '').replace(/-.*$/, '')) : null) ??
    '—'
  )
}

export async function worktreeList(): Promise<number> {
  const mainRoot = path.dirname(getGitCommonDir())
  const worktreesDir = path.join(mainRoot, '.worktrees')
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  ).filter(e => e.path.startsWith(worktreesDir + path.sep))

  if (entries.length === 0) {
    console.log('(no worktrees under .worktrees/)')
    return 0
  }

  for (const e of entries) {
    const base = path.basename(e.path)
    const id = taskIdOf(base, e.branch)
    const dirty =
      gitOutput(['status', '--porcelain'], e.path).length > 0
        ? 'dirty'
        : 'clean'
    const nm = nodeModulesLinked(e.path) ? 'linked' : 'MISSING'
    console.log(
      `${id}\t${e.branch ?? '(detached)'}\t${dirty}\tnode_modules:${nm}\t${e.path}`
    )
  }
  return 0
}
