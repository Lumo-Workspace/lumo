import * as path from 'path'
import { createTaskWorktree } from '../commands/worktree-add'
import {
  findWorktreesByTaskId,
  getMainRoot,
  gitOutput,
  isMainCheckout,
  parseWorktreePorcelain,
  slugify,
} from './worktree'
import { readWorktreeConfig, WORKTREE_CONFIG_PATH } from './worktree-config'
import { warn } from './errors'

/** First few words of a task title as a branch/dir slug. */
export function slugFromTitle(title: string, maxWords = 4): string {
  return slugify(title).split('-').filter(Boolean).slice(0, maxWords).join('-')
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * The worktree step of `lumo session attach` (LUM-825). Best-effort and
 * purely additive: it prints lines, never throws and never changes attach's
 * exit code.
 *
 * - The task already has worktree(s) → list every one (never silently pick),
 *   marking the one the session is in, else a `cd` hint.
 * - The session is already in some other linked worktree (a Claude Code /
 *   desktop worktree, say) → say so and create nothing.
 * - Main checkout, no worktree → create one when opted in (`--worktree`, or
 *   `autoWorktree: true` in .lumo/worktree.json and not `--no-worktree`),
 *   otherwise hint `lumo worktree add`.
 */
export function attachWorktreeStep(args: {
  taskId: string
  taskTitle: string
  /** `--worktree` true, `--no-worktree` false, neither undefined. */
  create: boolean | undefined
  cwd?: string
}): void {
  const cwd = args.cwd ?? process.cwd()
  try {
    let mainRoot: string
    try {
      mainRoot = getMainRoot(cwd)
    } catch {
      return // not a git repo — nothing to say
    }
    const entries = parseWorktreePorcelain(
      gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
    )
    const matches = findWorktreesByTaskId(entries, args.taskId, mainRoot)

    if (matches.length > 0) {
      console.log('')
      console.log(
        matches.length === 1
          ? `Worktree for ${args.taskId}:`
          : `${matches.length} worktrees match ${args.taskId} — pick the one to work in:`
      )
      const here = matches.find(m => isInside(cwd, m.path))
      for (const m of matches) {
        const mark = m === here ? '  ← you are here' : ''
        console.log(`  ${m.path}  (${m.branch ?? 'detached'})${mark}`)
      }
      if (!here && matches.length === 1) {
        console.log(`  cd ${matches[0]!.path}`)
      }
      return
    }

    if (!isMainCheckout(cwd)) {
      console.log('')
      console.log(
        `Worktree: this session already runs in a linked worktree (${path.resolve(cwd)}) — not creating another`
      )
      return
    }

    const { config, problems } = readWorktreeConfig(mainRoot)
    for (const p of problems) {
      console.error(warn(`${WORKTREE_CONFIG_PATH}: ${p}`))
    }
    const wantCreate = args.create ?? config.autoWorktree ?? false
    if (!wantCreate) {
      console.log('')
      console.log(
        `Worktree: none for ${args.taskId} — \`lumo worktree add ${args.taskId} [slug]\` to work in isolation from the main checkout`
      )
      return
    }

    console.log('')
    console.log(`Creating a worktree for ${args.taskId} …`)
    const slug = slugFromTitle(args.taskTitle) || undefined
    const result = createTaskWorktree({
      root: mainRoot,
      taskId: args.taskId,
      slug,
      opts: {},
      config,
    })
    if (!result.ok) {
      console.error(
        warn(
          `could not create a worktree (${result.error}); attach itself succeeded — run \`lumo worktree add ${args.taskId}\` to retry`
        )
      )
      return
    }
    console.log(`✓ Worktree ready: ${result.dir}`)
    console.log(`  branch: ${result.branch} (from ${result.base})`)
    console.log(`  cd ${result.dir}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(warn(`worktree step skipped (${msg})`))
  }
}
