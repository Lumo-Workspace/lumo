import { spawnSync } from 'child_process'
import { existsSync, statSync } from 'fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'path'

/**
 * LUM-893 — the local half of the HARDCODED_SECRET "is this file ever going to
 * be committed?" question.
 *
 * A developer secret written to a gitignored file (`.env.local`, a local
 * override) is not hardcoded into the code: it never leaves the machine through
 * git. Only the hook, running in the customer's checkout, can ask git whether a
 * written path is ignored, so it asks and the server turns the answer into an
 * advisory (never DONE-blocking) crossing.
 *
 * `git check-ignore` exit codes: 0 = ignored, 1 = not ignored (tracked files
 * are never reported ignored — a tracked `.env` still gets committed, so it
 * stays blocking). Anything else (not a repository, a path outside the work
 * tree, git missing, a timeout) is `null`: the caller omits the field and the
 * server keeps its fail-closed judgement.
 *
 * LUM-903: git runs in the checkout the FILE lives in, not the session cwd. A
 * session parked in the main checkout writing into `.worktrees/<task>/` would
 * otherwise ask the main checkout, whose `.gitignore` hides `.worktrees/` —
 * and every tracked file in the worktree came back "ignored".
 */
const GIT_TIMEOUT_MS = 2000

/** Nearest existing directory at or above `dir` (a deleted parent still answers). */
function nearestExistingDir(dir: string): string | null {
  let cur = dir
  for (;;) {
    try {
      if (existsSync(cur) && statSync(cur).isDirectory()) return cur
    } catch {
      // fall through to the parent
    }
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

export function probeWrittenPathIgnored(
  sessionCwd: string,
  filePath: string
): boolean | null {
  try {
    const absPath = isAbsolute(filePath)
      ? filePath
      : resolve(sessionCwd, filePath)
    const cwd = nearestExistingDir(dirname(absPath))
    if (cwd === null) return null
    // Relative to the probe cwd so a symlinked prefix (macOS /var → /private/var)
    // can never read as "outside the work tree".
    const target = relative(cwd, absPath)
    const r = spawnSync('git', ['check-ignore', '-q', '--', target], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      stdio: 'ignore',
    })
    if (r.error) return null
    if (r.status === 0) return true
    if (r.status === 1) return false
    return null
  } catch {
    return null
  }
}

/**
 * LUM-904 — the written file's path inside its OWN checkout, from
 * `git rev-parse --show-prefix` run beside the file (same probe cwd as above).
 * The server judges the test/fixture/doc path downgrade on it: a session
 * started in a parent directory (`~` for `~/docs/app`) makes the checkout's
 * location look like part of the path. `resolve` has already collapsed `..`.
 * `null` when git cannot answer (not a repository, git missing, a timeout) —
 * the server then falls back to the session cwd.
 */
export function probeCheckoutRelativePath(
  sessionCwd: string,
  filePath: string
): string | null {
  try {
    const absPath = isAbsolute(filePath)
      ? filePath
      : resolve(sessionCwd, filePath)
    const cwd = nearestExistingDir(dirname(absPath))
    if (cwd === null) return null
    const r = spawnSync('git', ['rev-parse', '--show-prefix'], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
    const prefix = r.stdout.trim()
    const rest = relative(cwd, absPath).split(sep).join('/')
    if (rest === '' || rest.startsWith('..')) return null
    return prefix + rest
  } catch {
    return null
  }
}

/** Tool events that write a file to disk (LUM-904: NotebookEdit too). */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])

/** The written path: `file_path`, or NotebookEdit's `notebook_path`. */
export function writtenFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path']) {
    const v = o[key]
    if (typeof v === 'string' && v) return v
  }
  return null
}
