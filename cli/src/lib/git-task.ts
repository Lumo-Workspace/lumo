import { spawnSync } from 'child_process'

/**
 * A task identifier inferred from local git state, plus where it was found
 * so the auto-bind message can explain its reasoning ("依据分支名/最近 commit").
 */
export interface GitTaskMatch {
  identifier: string
  source: 'branch' | 'commit'
}

/**
 * How many recent commit subjects to scan when the branch name carries no
 * task id (e.g. on a generic feature branch or detached HEAD).
 */
const DEFAULT_COMMIT_DEPTH = 20

const TASK_RE = /LUM-(\d+)/i

/**
 * Pull the first `LUM-<n>` token out of arbitrary text (a branch name or a
 * commit subject) and normalize it to upper case. Returns null when no task
 * id is present. The leading `-` in the pattern means the bare word `lumo`
 * never matches.
 */
export function matchTaskIdentifier(text: string): string | null {
  const m = text.match(TASK_RE)
  return m ? `LUM-${m[1]}` : null
}

/**
 * Run a git subcommand and return trimmed stdout, or '' on any failure
 * (non-zero exit, spawn error, not a repository, timeout). Never throws.
 */
function gitOutput(args: string[], cwd?: string): string {
  try {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 2000,
    })
    if (r.error || r.status !== 0) return ''
    return (r.stdout ?? '').trim()
  } catch {
    return ''
  }
}

/**
 * Infer the task to work on from local git: prefer the current branch name
 * (e.g. `lumo/LUM-145-...`), then fall back to the most recent commit
 * subjects (e.g. `... [LUM-145]`). Returns null when nothing matches —
 * detached HEAD (branch reads `HEAD`), a non-lumo branch with no tagged
 * commits, or a directory that is not a git repository all degrade to null.
 */
export function extractTaskFromGit(
  cwd?: string,
  commitDepth = DEFAULT_COMMIT_DEPTH
): GitTaskMatch | null {
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  const fromBranch = matchTaskIdentifier(branch)
  if (fromBranch) return { identifier: fromBranch, source: 'branch' }

  const log = gitOutput(['log', '-n', String(commitDepth), '--format=%s'], cwd)
  const fromLog = matchTaskIdentifier(log)
  if (fromLog) return { identifier: fromLog, source: 'commit' }

  return null
}
