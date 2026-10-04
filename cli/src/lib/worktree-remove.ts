import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { gitOutput, parseWorktreePorcelain, runGit } from './worktree'

/**
 * Remove one worktree without leaving a half-deleted directory (LUM-971).
 *
 * Root cause of the half-deleted `.worktrees/<id>` directories: a process
 * still running in the worktree (a `next dev` whose workflow builder
 * regenerates `app/.well-known/workflow/v1/**`) writes files while
 * `git worktree remove` deletes the tree. git's recursive delete stops at the
 * first `rmdir` that fails with "Directory not empty", yet git still deletes
 * the worktree's admin dir (`.git/worktrees/<id>`) — "no going back from
 * here". The worktree is then unregistered while most of its files remain.
 * The writer can also recreate the generated dirs right after a successful
 * removal.
 *
 * So the safety decision stays with git: git checks the tree is clean (or the
 * caller passed --force after the user acknowledged the loss) before it
 * deletes anything. Only once git has unregistered the worktree — i.e. git
 * already decided it may go — does this finish the deletion itself. If git
 * refused (the worktree is still registered), nothing is touched.
 */

export interface WorktreeResidue {
  /** One line per top-level entry left behind, e.g. "app/ (4 files)". */
  entries: string[]
  /** Processes whose cwd is still inside the directory (best effort). */
  processes: string[]
  /** A shell command that deletes what is left. */
  cleanupCommand: string
}

export type WorktreeRemoval =
  | { status: 'removed' }
  /** git refused before deleting anything; the worktree is intact. */
  | { status: 'refused'; error: string }
  /** git unregistered it but the directory could not be fully deleted. */
  | { status: 'residue'; residue: WorktreeResidue }

const RETRY_ROUNDS = 3
const SETTLE_MS = 300
const ENTRY_LIMIT = 8
const COUNT_CAP = 10_000

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Whether `git worktree list` still lists `wtPath`. */
export function isRegisteredWorktree(
  mainRoot: string,
  wtPath: string
): boolean {
  const entries = parseWorktreePorcelain(
    gitOutput(['worktree', 'list', '--porcelain'], mainRoot)
  )
  const want = path.resolve(wtPath)
  return entries.some(e => path.resolve(e.path) === want)
}

/** Single-quote a path for a POSIX shell. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Count files under `dir`, stopping at `cap` (returns cap when reached). */
function countFiles(dir: string, cap: number): number {
  let n = 0
  const stack = [dir]
  while (stack.length > 0 && n < cap) {
    const cur = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name))
      else n++
      if (n >= cap) break
    }
  }
  return n
}

/** "app/ (4 files)" lines for the top-level entries left in `dir`. */
export function summarizeResidue(dir: string): string[] {
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  ents.sort((a, b) => a.name.localeCompare(b.name))
  const lines = ents.slice(0, ENTRY_LIMIT).map(e => {
    if (!e.isDirectory()) return e.name
    const n = countFiles(path.join(dir, e.name), COUNT_CAP)
    const count = n >= COUNT_CAP ? `${COUNT_CAP}+` : String(n)
    return `${e.name}/ (${count} file${n === 1 ? '' : 's'})`
  })
  if (ents.length > ENTRY_LIMIT) {
    lines.push(`… and ${ents.length - ENTRY_LIMIT} more`)
  }
  return lines
}

/**
 * Parse `lsof -d cwd -F pcn` output into "pid 123 (node)" for every process
 * whose cwd is `dir` or below it.
 */
export function parseLsofCwd(output: string, dir: string): string[] {
  const root = path.resolve(dir)
  const found: string[] = []
  let pid = ''
  let cmd = ''
  for (const line of output.split('\n')) {
    const tag = line[0]
    const val = line.slice(1)
    if (tag === 'p') {
      pid = val
      cmd = ''
    } else if (tag === 'c') {
      cmd = val
    } else if (tag === 'n') {
      const p = path.resolve(val)
      if (p === root || p.startsWith(root + path.sep)) {
        found.push(`pid ${pid}${cmd ? ` (${cmd})` : ''}`)
      }
    }
  }
  return found
}

/** Processes still running inside `dir`; [] when lsof is unavailable. */
function processesInside(dir: string): string[] {
  const r = spawnSync('lsof', ['-n', '-P', '-d', 'cwd', '-F', 'pcn'], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (r.error || typeof r.stdout !== 'string') return []
  return parseLsofCwd(r.stdout, dir)
}

/**
 * Delete what git left behind. Retries a few rounds with a short settle so a
 * generator that writes once more after the delete does not win.
 */
function finishDeletion(dir: string): boolean {
  for (let round = 0; round < RETRY_ROUNDS; round++) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    } catch {
      // fall through to the existence check
    }
    sleepSync(SETTLE_MS)
    if (!fs.existsSync(dir)) return true
  }
  return false
}

export function removeWorktreeDir(
  mainRoot: string,
  wtPath: string,
  opts: { force?: boolean } = {}
): WorktreeRemoval {
  const args = opts.force
    ? ['worktree', 'remove', '--force', wtPath]
    : ['worktree', 'remove', wtPath]
  const r = runGit(args, mainRoot)
  const gitError = (r.stderr || '').trim() || 'git worktree remove failed'

  if (isRegisteredWorktree(mainRoot, wtPath)) {
    return { status: 'refused', error: gitError }
  }
  if (!fs.existsSync(wtPath) || finishDeletion(wtPath)) {
    return { status: 'removed' }
  }
  return {
    status: 'residue',
    residue: {
      entries: summarizeResidue(wtPath),
      processes: processesInside(wtPath),
      cleanupCommand: `rm -rf ${shellQuote(wtPath)}`,
    },
  }
}

/** Human lines describing a residue (shared by DONE, prune and rm). */
export function describeResidue(
  wtPath: string,
  residue: WorktreeResidue
): string[] {
  const lines = [
    `Warning: worktree ${wtPath} is unregistered from git, but its directory could not be fully deleted — something kept writing into it.`,
  ]
  if (residue.entries.length > 0) {
    lines.push(`  Left behind: ${residue.entries.join(', ')}`)
  }
  if (residue.processes.length > 0) {
    lines.push(
      `  Still running inside it: ${residue.processes.join(', ')} — stop it (e.g. the dev server) first`
    )
  }
  lines.push(`  Clean up with: ${residue.cleanupCommand}`)
  return lines
}
