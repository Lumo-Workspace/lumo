import { spawnSync } from 'child_process'
import { parseEvidencePointer } from '../../../shared/src/acceptance-evidence'

/**
 * Drill-down rendering for acceptance evidence pointers (LUM-563).
 *
 * A verdict's evidencePointer is a structured token (`cmd:…#exit=N`,
 * `file:path:line`, `commit:hash`). Printed raw it satisfies Norman's gulf of
 * evaluation only halfway: you can read it but not act on it. These helpers
 * turn each shape into a navigable / re-runnable line — a web commit URL when
 * the git remote resolves (else a `git show` fallback), a terminal-clickable
 * `path:line`, or the actual command + exit you can re-run to reproduce.
 *
 * No third-party deps; sanitization is applied by the caller (task-status.ts)
 * before anything reaches the terminal.
 */

/**
 * Normalize a git remote URL to its https web base (no trailing `.git`), or
 * null when it doesn't look like a remote we can navigate. Fails closed: a
 * shape we can't confidently map yields null so the caller drops to a
 * non-URL fallback rather than printing a broken link.
 *
 * Handles the three remote forms git emits:
 *   - scp-style  `git@host:owner/repo.git`
 *   - https      `https://host/owner/repo.git`
 *   - ssh url    `ssh://git@host/owner/repo.git`
 */
export function normalizeRepoWebUrl(remote: string): string | null {
  const raw = remote.trim()
  if (!raw) return null

  let host: string
  let path: string

  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(raw)
  if (scp) {
    host = scp[1]!
    path = scp[2]!
  } else {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'ssh:') return null
    host = url.host
    path = url.pathname
  }

  const cleanPath = path
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  // A navigable repo path is at minimum owner/repo — reject a bare host.
  if (!host || !cleanPath || !cleanPath.includes('/')) return null
  return `https://${host}/${cleanPath}`
}

/**
 * Resolve the current repo's web base by reading `origin`'s remote URL. Best
 * effort and side-effecting (runs git in the cwd), so it lives outside the pure
 * formatter and is injected via TaskStatusExtras. Null when not a git repo /
 * no origin / unparseable — the renderer then uses the `git show` fallback.
 */
export function resolveRepoWebUrl(cwd: string = process.cwd()): string | null {
  try {
    const r = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      timeout: 5_000,
    })
    if (r.status !== 0 || !r.stdout) return null
    return normalizeRepoWebUrl(r.stdout)
  } catch {
    return null
  }
}

/**
 * Render the actionable evidence body for one pointer (the text after
 * `↳ evidence: `). Unrecognised shapes fall back to the raw pointer so data is
 * never hidden, only upgraded when we know how.
 */
export function formatEvidenceDrilldown(
  pointer: string,
  repoWebUrl: string | null
): string {
  const parsed = parseEvidencePointer(pointer)
  if (!parsed) return pointer

  if (parsed.kind === 'cmd') {
    return `ran \`${parsed.command}\` → exit ${parsed.exitCode} · re-run to reproduce`
  }
  if (parsed.kind === 'file') {
    return `${parsed.path}:${parsed.line}`
  }
  // commit
  const short = parsed.hash.slice(0, 10)
  return repoWebUrl
    ? `commit ${short} · ${repoWebUrl}/commit/${parsed.hash}`
    : `commit ${short} · view with \`git show ${parsed.hash}\``
}
