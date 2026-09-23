import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { formatNextSteps } from '../lib/next-steps'
import {
  deriveBranchName,
  deriveWorktreeDirName,
  detectDefaultBranch,
  ensureWorktreesExcluded,
  huskyHooksPath,
  isMainCheckout,
  getRepoRoot,
  runGit,
} from '../lib/worktree'
import { resolveWorktreeTaskId } from '../lib/worktree-ref'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import { sanitizeField } from '../lib/sanitize'
import {
  isRepoRelativePath,
  readWorktreeConfig,
  WORKTREE_CONFIG_PATH,
  type WorktreeConfig,
} from '../lib/worktree-config'

export interface WorktreeAddOptions extends ConfirmFlags {
  base?: string | undefined
  noFetch?: boolean | undefined
  verify?: boolean | undefined
}

export type CreateWorktreeResult =
  | { ok: true; dir: string; branch: string; base: string }
  | { ok: false; error: string }

/**
 * Link/copy plan for a fresh worktree. A configured key replaces the
 * detected default: node_modules is linked only when the main checkout has
 * one, the husky shim is copied only when `core.hooksPath` points into
 * `.husky/` (plain `.git/hooks` are shared by every worktree already).
 */
export function planWorktreeFiles(
  root: string,
  config: WorktreeConfig
): { link: string[]; copy: string[] } {
  const link =
    config.linkPaths ??
    (fs.existsSync(path.join(root, 'node_modules')) ? ['node_modules'] : [])
  let copy = config.copyPaths
  if (!copy) {
    const hooks = huskyHooksPath(root)
    copy = hooks ? [hooks] : []
  }
  return { link, copy }
}

/**
 * True when `target` — resolved through any symlinks on its existing
 * ancestors — stays inside `base`. Guards against a tracked symlink in the
 * repo (e.g. `vendor -> /etc`) turning a clean relative config path into a
 * read or write outside the checkout.
 */
export function staysInside(target: string, base: string): boolean {
  let probe = path.resolve(target)
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) {
    probe = path.dirname(probe)
  }
  const real = path.join(
    fs.realpathSync(probe),
    path.relative(probe, path.resolve(target))
  )
  const rel = path.relative(fs.realpathSync(base), real)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Create `.worktrees/<id>[-slug]` on `lumo/<id>[-slug]` from the main
 * checkout at `root`. Prints progress lines; returns instead of exiting so
 * `session attach` can call it best-effort. Never removes anything.
 */
export function createTaskWorktree(args: {
  root: string
  taskId: string
  slug?: string | undefined
  opts: WorktreeAddOptions
  config: WorktreeConfig
}): CreateWorktreeResult {
  const { root, taskId, slug, opts, config } = args
  const branch = deriveBranchName(taskId, slug)
  const dir = path.join(root, '.worktrees', deriveWorktreeDirName(taskId, slug))

  if (fs.existsSync(dir)) {
    return {
      ok: false,
      error: `${dir} already exists — remove it first or pick a different slug`,
    }
  }

  let base: string
  if (opts.base) {
    base = opts.base
  } else {
    const name = detectDefaultBranch(root, { allowNetwork: !opts.noFetch })
    if (!name) {
      return {
        ok: false,
        error:
          'could not determine the remote default branch (no origin/HEAD, origin/main or origin/master) — pass --base <ref>',
      }
    }
    base = `origin/${name}`
    if (!opts.noFetch) {
      console.log(`Fetching ${base} …`)
      if (runGit(['fetch', 'origin', name], root).status !== 0) {
        console.error(
          `Warning: git fetch failed; branching off the existing local ${base} (may be stale)`
        )
      }
    }
  }

  fs.mkdirSync(path.dirname(dir), { recursive: true })
  if (ensureWorktreesExcluded(root)) {
    console.log('  .worktrees/ added to .git/info/exclude (local only)')
  }

  const branchExists =
    runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
      .status === 0
  const addArgs = branchExists
    ? ['worktree', 'add', dir, branch]
    : ['worktree', 'add', dir, '-b', branch, base]
  const added = runGit(addArgs, root)
  if (added.status !== 0) {
    return {
      ok: false,
      error: (added.stderr || '').trim() || 'git worktree add failed',
    }
  }

  const plan = planWorktreeFiles(root, config)
  // Re-checked here, not only when parsing: the paths are joined onto both
  // the main checkout and the new worktree, and must never leave either.
  plan.link = plan.link.filter(isRepoRelativePath)
  plan.copy = plan.copy.filter(isRepoRelativePath)
  const escapes = (rel: string) =>
    !staysInside(path.join(root, rel), root) ||
    !staysInside(path.join(dir, rel), dir)
  for (const rel of plan.link) {
    const src = path.join(root, rel)
    if (escapes(rel)) {
      console.log(`Warning: ${rel} resolves outside the repo; not linked`)
      continue
    }
    if (!fs.existsSync(src)) {
      console.log(`Warning: ${rel} is not in the main checkout; not linked`)
      continue
    }
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.symlinkSync(src, path.join(dir, rel))
    console.log(`  linked:        ${rel} → main checkout`)
  }
  for (const rel of plan.copy) {
    const src = path.join(root, rel)
    if (escapes(rel)) {
      console.log(`Warning: ${rel} resolves outside the repo; not copied`)
      continue
    }
    if (!fs.existsSync(src)) {
      // The one warning that matters: husky routes hooks through this dir,
      // so without it git silently skips every hook in the worktree.
      console.log(
        `Warning: ${rel} is not in the main checkout; not copied (if it is a git-hooks dir, hooks will NOT run in this worktree)`
      )
      continue
    }
    fs.cpSync(src, path.join(dir, rel), { recursive: true })
    console.log(`  copied:        ${rel}`)
  }

  return { ok: true, dir, branch, base }
}

function printGuidance(
  result: { dir: string; branch: string; base: string },
  notes: string[]
): void {
  console.log('')
  console.log(`✓ Worktree ready: ${result.dir}`)
  console.log(`  branch:        ${result.branch} (from ${result.base})`)
  console.log('')
  // Locally-static source: no server round-trip to carry steps, but the same
  // renderer so the block looks identical everywhere (LUM-686).
  console.log(
    formatNextSteps([
      { command: `cd ${result.dir}`, why: 'work from the isolated checkout' },
    ])
  )
  if (notes.length > 0) {
    console.log('')
    console.log(`Notes for this repo (${WORKTREE_CONFIG_PATH}):`)
    for (const note of notes) console.log(`  • ${note}`)
  }
}

export async function worktreeAdd(
  rawId: string,
  slug: string | undefined,
  opts: WorktreeAddOptions
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
      'Error: run `lumo worktree add` from the main checkout, not inside a worktree'
    )
    return 1
  }

  const root = getRepoRoot()
  const { config, problems } = readWorktreeConfig(root)
  for (const p of problems) {
    console.error(`Warning: ${WORKTREE_CONFIG_PATH}: ${p}`)
  }

  // `verifyCommand` is a shell command from a committed repo file — the user
  // sees it and approves it before anything happens (exit 4, nothing
  // created), so a hostile repo cannot run code on `--verify` alone.
  const verifyCommand =
    opts.verify && config.verifyCommand ? config.verifyCommand : null
  // What the user approves must be byte-for-byte what runs: a command with
  // control characters (e.g. terminal escapes that hide part of it) would
  // display differently from how it executes, so it is refused outright.
  if (verifyCommand && sanitizeField(verifyCommand) !== verifyCommand) {
    console.error(
      `Error: verifyCommand in ${WORKTREE_CONFIG_PATH} contains control characters; refusing to show or run it`
    )
    return 1
  }
  if (verifyCommand && !isConfirmed(opts)) {
    return emitConfirmation({
      command: 'worktree add',
      changes: [
        `Will create worktree .worktrees/${deriveWorktreeDirName(taskId, slug)} on branch ${deriveBranchName(taskId, slug)}`,
        `Will then run this shell command from ${WORKTREE_CONFIG_PATH} inside it:`,
        `  ${verifyCommand}`,
        'Only confirm if you trust this repository to run it',
      ],
    })
  }

  const result = createTaskWorktree({ root, taskId, slug, opts, config })
  if (!result.ok) {
    console.error(`Error: ${result.error}`)
    return 1
  }
  printGuidance(result, config.notes ?? [])

  if (opts.verify) {
    if (!config.verifyCommand) {
      console.error(
        `Warning: --verify needs "verifyCommand" in ${WORKTREE_CONFIG_PATH}; skipped`
      )
      return 0
    }
    // Printed again at run time: this is the command actually executed.
    console.log(
      `Running baseline (${WORKTREE_CONFIG_PATH}): ${verifyCommand} …`
    )
    const v = spawnSync(config.verifyCommand, {
      cwd: result.dir,
      stdio: 'inherit',
      shell: true,
    })
    if (v.status !== 0) {
      console.error('Warning: baseline verify command did not pass cleanly')
    }
  }

  return 0
}
