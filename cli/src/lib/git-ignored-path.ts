import { spawnSync } from 'child_process'

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
 */
const GIT_TIMEOUT_MS = 2000

export function probeWrittenPathIgnored(
  cwd: string,
  filePath: string
): boolean | null {
  try {
    const r = spawnSync('git', ['check-ignore', '-q', '--', filePath], {
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

/** Tool events whose `tool_input.file_path` is written to disk. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'MultiEdit',
])
