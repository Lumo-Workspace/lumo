import { spawnSync } from 'child_process'

import { matchTaskIdentifier } from '../../../shared/src/task-identifier'

/**
 * Identifier extraction is single-sourced in shared/src/task-identifier.ts
 * (same pattern the server uses for webhook branch→task linking, LUM-419) —
 * any team prefix matches, not just LUM-. Re-exported for existing consumers.
 */
export { matchTaskIdentifier }

/**
 * A task identifier inferred from local git state, plus where it was found
 * so the auto-bind message can explain its reasoning ("from branch name" / "from recent commits").
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
 * subjects (e.g. `... [LUM-145]`). Any team prefix matches (SPEC-12 as much
 * as LUM-145). Returns null when nothing matches — detached HEAD (branch
 * reads `HEAD`), a branch with no identifier and no tagged commits, or a
 * directory that is not a git repository all degrade to null.
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
