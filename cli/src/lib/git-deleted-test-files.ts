import { spawnSync } from 'child_process'

import { isTestFilePath } from '../../../shared/src/test-file-path'

/**
 * LUM-779 — the local half of the TEST_FILE_DELETED net-deletion verdict.
 *
 * The server's matcher only sees command TEXT, and text lies: a restore from
 * HEAD, a `cp` back from a .bak, or an `rm` of a scratch probe the agent wrote
 * seconds earlier all look like "deleted a test file" and none of them did.
 * What settles it is repo state — is a tracked test file missing now — and
 * only the hook, running on the agent's machine, can ask git that question.
 *
 * `collectDeletedTestFiles` answers with the tracked test files that are gone:
 *   - working tree + index vs HEAD (`git diff HEAD --diff-filter=D`) — a plain
 *     `rm` or a `git rm` of a tracked file, not yet committed
 *   - commits on top of the base branch (`git log --diff-filter=D base..HEAD`)
 *     — an `rm … && git commit` chained in one command would otherwise be
 *     invisible to the first probe
 * Filtered by the shared test-path pattern, sorted, de-duplicated.
 *
 * `null` means the probe could not answer (not a repository, git missing, a
 * timeout) — the caller omits the field and the server keeps its fail-closed
 * blocking behaviour. `[]` is a verdict: the probe ran and nothing is missing.
 */

/** Base-branch candidates, in order. The first that resolves wins. */
const BASE_REF_CANDIDATES = [
  'refs/remotes/origin/HEAD',
  'refs/remotes/origin/main',
  'refs/remotes/origin/master',
  'refs/remotes/origin/develop',
]

const GIT_TIMEOUT_MS = 2000

interface GitResult {
  ok: boolean
  stdout: string
}

function runGit(args: string[], cwd: string): GitResult {
  try {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (r.error || r.status !== 0) return { ok: false, stdout: '' }
    return { ok: true, stdout: r.stdout ?? '' }
  } catch {
    return { ok: false, stdout: '' }
  }
}

/** NUL-separated path list → paths (empty entries dropped). */
function splitPaths(stdoutZ: string): string[] {
  return stdoutZ.split('\0').filter(p => p.length > 0)
}

function resolveBaseRef(cwd: string): string | null {
  for (const ref of BASE_REF_CANDIDATES) {
    if (runGit(['rev-parse', '--verify', '-q', ref], cwd).ok) return ref
  }
  return null
}

export function collectDeletedTestFiles(cwd: string): string[] | null {
  // Working tree + index vs HEAD. Also the "is this a repo with a HEAD"
  // probe: a non-repository, or git itself missing, fails here → null.
  const uncommitted = runGit(
    ['diff', 'HEAD', '--diff-filter=D', '--name-only', '-z'],
    cwd
  )
  if (!uncommitted.ok) return null
  const missing = new Set(splitPaths(uncommitted.stdout))

  // Deletions already committed on top of the base branch. Best-effort: no
  // resolvable base (a repo with no remote) just skips this half.
  const base = resolveBaseRef(cwd)
  if (base) {
    const committed = runGit(
      [
        'log',
        '--diff-filter=D',
        '--name-only',
        '--format=',
        '-z',
        `${base}..HEAD`,
      ],
      cwd
    )
    if (committed.ok) {
      for (const p of splitPaths(committed.stdout)) missing.add(p)
    }
  }

  return [...missing].filter(isTestFilePath).sort()
}

/**
 * Cheap pre-filter deciding whether the probe is worth running at all: an
 * `rm` / `git rm` token anywhere in the command, including inside a `bash -c`
 * wrapper string. Deliberately a SUPERSET of the server's matcher — a probe
 * that runs for an `rm` of a non-test file costs two git calls and nothing
 * else, whereas a probe that is skipped for a command the server does flag
 * leaves the server fail-closed on a possible false positive.
 */
export function looksLikeDeleteCommand(command: string): boolean {
  return /(?:^|[\s(;&|"'`])(?:rm|git\s+rm)\b/.test(command)
}
