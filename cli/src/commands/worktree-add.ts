import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import {
  normalizeTaskId,
  deriveBranchName,
  deriveWorktreeDirName,
  isMainCheckout,
  getRepoRoot,
  runGit,
} from '../lib/worktree'

export interface WorktreeAddOptions {
  base?: string | undefined
  noFetch?: boolean | undefined
  verify?: boolean | undefined
}

function printGuidance(dir: string, branch: string): void {
  console.log('')
  console.log(`✓ Worktree ready: ${dir}`)
  console.log(`  branch:        ${branch}`)
  console.log(`  node_modules:  symlinked to main checkout`)
  console.log('')
  console.log('Next:')
  console.log(`  cd ${dir}`)
  console.log('')
  console.log('Gotchas baked into this worktree:')
  console.log(
    '  • prisma: the generated client is SHARED via the node_modules symlink.'
  )
  console.log(
    "          Don't run `prisma generate` mid-work across parallel worktrees;"
  )
  console.log(
    '          verify with jest, and do generate+tsc atomically once at the end.'
  )
  console.log(
    '  • jest:   always run it from INSIDE this worktree (cd first), or the'
  )
  console.log(
    '          cli/package.json haste collision silently runs the wrong tests.'
  )
}

export async function worktreeAdd(
  rawId: string,
  slug: string | undefined,
  opts: WorktreeAddOptions
): Promise<number> {
  const taskId = normalizeTaskId(rawId)
  if (!taskId) {
    console.error(`Error: "${rawId}" is not a task id (expected LUM-N or N)`)
    return 1
  }
  if (!isMainCheckout()) {
    console.error(
      'Error: run `lumo worktree add` from the main checkout, not inside a worktree'
    )
    return 1
  }

  const root = getRepoRoot()
  const branch = deriveBranchName(taskId, slug)
  const dir = path.join(root, '.worktrees', deriveWorktreeDirName(taskId, slug))

  if (fs.existsSync(dir)) {
    console.error(
      `Error: ${dir} already exists — remove it first or pick a different slug`
    )
    return 1
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true })

  const base = opts.base ?? 'origin/main'
  if (!opts.noFetch && !opts.base) {
    console.log('Fetching origin/main …')
    if (runGit(['fetch', 'origin', 'main'], root).status !== 0) {
      console.error(`Warning: git fetch failed; branching off local ${base}`)
    }
  }

  const branchExists =
    runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
      .status === 0
  const addArgs = branchExists
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', dir, '-b', branch, base]
  const added = runGit(addArgs, root)
  if (added.status !== 0) {
    console.error(
      `Error: ${(added.stderr || '').trim() || 'git worktree add failed'}`
    )
    return 1
  }

  const srcModules = path.join(root, 'node_modules')
  if (fs.existsSync(srcModules)) {
    fs.symlinkSync(srcModules, path.join(dir, 'node_modules'))
  } else {
    console.log(
      'Warning: main checkout has no node_modules; run `npm install` there, then symlink manually'
    )
  }

  printGuidance(dir, branch)

  if (opts.verify) {
    console.log('Running baseline jest …')
    const j = spawnSync('npx', ['jest'], { cwd: dir, stdio: 'inherit' })
    if (j.status !== 0) {
      console.error('Warning: baseline jest did not pass cleanly')
    }
  }

  return 0
}
