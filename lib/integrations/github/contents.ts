/**
 * GitHub read helpers for fetching committed files and PR diffs.
 *
 * Uses raw fetch (same pattern as lib/integrations/github/sync.ts) — no new
 * npm deps. Every call mints a token for the one repository it reads via
 * getRepoToken(workspaceId, fullName) — refused (403 repo_not_confirmed) for a
 * repository outside the workspace's confirmed list (LUM-883).
 */

import { logger } from '@/lib/logger'
import { getRepoToken, revokeInstallationToken } from './auth'
import { REPO_TOKEN_PERMISSIONS } from './token-permissions'

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'uselumo/1.0',
}

/**
 * Splits "owner/repo" safely under noUncheckedIndexedAccess.
 */
function splitFullName(fullName: string): [string, string] {
  const parts = fullName.split('/')
  const owner = parts[0]
  const repo = parts[1]
  if (!owner || !repo) {
    throw new Error(
      `Invalid fullName — expected "owner/repo", got "${fullName}"`
    )
  }
  return [owner, repo]
}

/**
 * LUM-988 — a repository path as a URL path: each segment percent-encoded.
 * Paths come from the customer's diff, so `faq#1.md` or `a?b.ts` would
 * otherwise turn into a fragment / query and fetch a different file.
 */
export function encodeRepoPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Reads a file from a GitHub repository at a given ref.
 * Returns the decoded UTF-8 content, or null if the file does not exist (404).
 */
export async function readRepoFile(opts: {
  workspaceId: string
  fullName: string
  path: string
  ref?: string
}): Promise<string | null> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.contentsRead
  )
  return readRepoFileWithToken({ ...opts, token })
}

/**
 * LUM-988 — run `fn` with ONE contents:read installation token for the
 * repository, then revoke it. For a caller that reads many files of one
 * repository with `readRepoFileWithToken`. Minting refuses an unconfirmed
 * repository (LUM-883) and that throw propagates; revocation never throws.
 */
export async function withRepoReadToken<T>(
  opts: { workspaceId: string; fullName: string },
  fn: (token: string) => Promise<T>
): Promise<T> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.contentsRead
  )
  try {
    return await fn(token)
  } finally {
    // Never throws by contract; guarded so a future change cannot turn
    // cleanup into a lost result. The token expires on its own anyway.
    await revokeInstallationToken(token).catch(() => false)
  }
}

/**
 * LUM-988 — `readRepoFile` with a token the caller already holds, for a
 * caller that reads many files of one repository: minting a token per file
 * meant up to 60 installation-token mints per scan, none revoked. The caller
 * mints it with `getRepoToken` (which refuses an unconfirmed repository) and
 * revokes it when done.
 */
export async function readRepoFileWithToken(opts: {
  token: string
  fullName: string
  path: string
  ref?: string
  /** Aborts the request (an aborted read throws, and logs nothing). */
  signal?: AbortSignal
}): Promise<string | null> {
  const [owner, repo] = splitFullName(opts.fullName)

  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(opts.path)}`
  )
  if (opts.ref) url.searchParams.set('ref', opts.ref)

  const res = await fetch(url.toString(), {
    headers: {
      ...GH_HEADERS,
      // Request raw content directly — GitHub returns the file bytes as text
      Accept: 'application/vnd.github.raw',
      Authorization: `Bearer ${opts.token}`,
    },
    ...(opts.signal ? { signal: opts.signal } : {}),
  })

  if (res.status === 404) return null

  if (!res.ok) {
    logger.error(
      `[github/contents] readRepoFile failed for ${opts.fullName}/${opts.path}: ${res.status}`
    )
    throw Object.assign(
      new Error(
        `GitHub API error ${res.status} for ${opts.fullName}/${opts.path}`
      ),
      { status: res.status }
    )
  }

  return res.text()
}

/**
 * Fetches the unified diff for a pull request.
 * Returns the raw diff text.
 */
export async function fetchPrDiff(opts: {
  workspaceId: string
  fullName: string
  prNumber: number
}): Promise<string> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.contentsRead
  )
  const [owner, repo] = splitFullName(opts.fullName)

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${opts.prNumber}`,
    {
      headers: {
        ...GH_HEADERS,
        Accept: 'application/vnd.github.v3.diff',
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!res.ok) {
    logger.error(
      `[github/contents] fetchPrDiff failed for ${opts.fullName}#${opts.prNumber}: ${res.status}`
    )
    throw Object.assign(
      new Error(
        `GitHub API error ${res.status} for PR ${opts.fullName}#${opts.prNumber}`
      ),
      { status: res.status }
    )
  }

  return res.text()
}

/** One entry of GitHub's `pulls/{n}/files` listing, narrowed to what the
 *  re-judge reads (LUM-780). */
export interface PrFileEntry {
  filename: string
  /** added | removed | modified | renamed | copied | changed | unchanged */
  status: string
}

const PR_FILES_PER_PAGE = 100
const PR_FILES_MAX_PAGES = 10

/**
 * LUM-780 — the files a pull request touches, with GitHub's per-file status.
 * The TEST_FILE_DELETED re-judge asks "does any linked PR remove a tracked
 * test file"; `status === 'removed'` is the durable, external answer the old
 * rows (no local-git probe) never had. Paginates up to PR_FILES_MAX_PAGES ×
 * PR_FILES_PER_PAGE files; throws on any non-2xx or on a PR larger than that
 * — the caller treats a throw as "unreadable", never as "nothing removed".
 */
export async function fetchPrFiles(opts: {
  workspaceId: string
  fullName: string
  prNumber: number
}): Promise<PrFileEntry[]> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.pullRequestRead
  )
  const [owner, repo] = splitFullName(opts.fullName)
  const out: PrFileEntry[] = []
  for (let page = 1; page <= PR_FILES_MAX_PAGES; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${opts.prNumber}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      throw Object.assign(
        new Error(
          `GitHub API error ${res.status} for PR files ${opts.fullName}#${opts.prNumber}`
        ),
        { status: res.status }
      )
    }
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) {
      throw new Error(
        `GitHub pulls/files payload is not a list for ${opts.fullName}#${opts.prNumber}`
      )
    }
    for (const f of body as Array<Record<string, unknown>>) {
      if (typeof f.filename !== 'string' || typeof f.status !== 'string') {
        throw new Error(
          `GitHub pulls/files entry missing filename/status for ${opts.fullName}#${opts.prNumber}`
        )
      }
      out.push({ filename: f.filename, status: f.status })
    }
    if (body.length < PR_FILES_PER_PAGE) return out
  }
  throw new Error(
    `PR ${opts.fullName}#${opts.prNumber} has more than ${PR_FILES_MAX_PAGES * PR_FILES_PER_PAGE} files — file list not read`
  )
}

/**
 * LUM-634 — fetches a PR's change-volume stats (additions / deletions /
 * changed_files) from the pulls API JSON. Throws on any non-2xx or on a
 * payload missing the numeric fields — the backfill treats every throw as an
 * explicit skip and NEVER substitutes a fabricated 0.
 */
export async function fetchPrStats(opts: {
  workspaceId: string
  fullName: string
  prNumber: number
}): Promise<{ additions: number; deletions: number; changedFiles: number }> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.pullRequestRead
  )
  const [owner, repo] = splitFullName(opts.fullName)

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${opts.prNumber}`,
    {
      headers: {
        ...GH_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    }
  )

  if (!res.ok) {
    throw Object.assign(
      new Error(
        `GitHub API error ${res.status} for PR ${opts.fullName}#${opts.prNumber}`
      ),
      { status: res.status }
    )
  }

  const body = (await res.json()) as {
    additions?: unknown
    deletions?: unknown
    changed_files?: unknown
  }
  const { additions, deletions, changed_files: changedFiles } = body
  if (
    typeof additions !== 'number' ||
    typeof deletions !== 'number' ||
    typeof changedFiles !== 'number'
  ) {
    throw new Error(
      `GitHub pulls payload missing change-volume fields for ${opts.fullName}#${opts.prNumber}`
    )
  }
  return { additions, deletions, changedFiles }
}

/**
 * LUM-732 — the PR's CURRENT head commit SHA from the pulls API. The scan
 * worker keys its dedup on this (not on the webhook's head.sha, which may be
 * stale by the time the worker runs). Throws on non-2xx or a missing field.
 */
export async function fetchPrHeadSha(opts: {
  workspaceId: string
  fullName: string
  prNumber: number
}): Promise<string> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.pullRequestRead
  )
  const [owner, repo] = splitFullName(opts.fullName)

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${opts.prNumber}`,
    { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw Object.assign(
      new Error(
        `GitHub API error ${res.status} for PR ${opts.fullName}#${opts.prNumber}`
      ),
      { status: res.status }
    )
  }
  const body = (await res.json()) as { head?: { sha?: unknown } }
  const sha = body.head?.sha
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new Error(
      `GitHub pulls payload missing head.sha for ${opts.fullName}#${opts.prNumber}`
    )
  }
  return sha
}

/**
 * LUM-738 — the default branch and its current head sha, for the repository
 * security baseline. Two calls (repo → default_branch, then the branch ref).
 * Throws on non-2xx or a missing field.
 */
export async function fetchDefaultBranchHead(opts: {
  workspaceId: string
  fullName: string
}): Promise<{ branch: string; sha: string }> {
  const token = await getRepoToken(
    opts.workspaceId,
    opts.fullName,
    REPO_TOKEN_PERMISSIONS.contentsRead
  )
  const [owner, repo] = splitFullName(opts.fullName)
  const headers = { ...GH_HEADERS, Authorization: `Bearer ${token}` }

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers,
  })
  if (!repoRes.ok) {
    throw Object.assign(
      new Error(`GitHub API error ${repoRes.status} for repo ${opts.fullName}`),
      { status: repoRes.status }
    )
  }
  const repoBody = (await repoRes.json()) as { default_branch?: unknown }
  const branch = repoBody.default_branch
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error(
      `GitHub repo payload missing default_branch for ${opts.fullName}`
    )
  }

  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers }
  )
  if (!refRes.ok) {
    throw Object.assign(
      new Error(
        `GitHub API error ${refRes.status} for ref heads/${branch} of ${opts.fullName}`
      ),
      { status: refRes.status }
    )
  }
  const refBody = (await refRes.json()) as { object?: { sha?: unknown } }
  const sha = refBody.object?.sha
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new Error(
      `GitHub ref payload missing object.sha for heads/${branch} of ${opts.fullName}`
    )
  }
  return { branch, sha }
}

/**
 * PURE — parses a unified diff and returns added lines per file.
 *
 * - New-file path is extracted from `+++ b/<path>` headers.
 * - Lines starting with `+` (excluding the `+++` header itself) are collected;
 *   the leading `+` is stripped.
 * - Files with no added lines are excluded from the result.
 */
export function addedLinesFromDiff(
  diff: string
): { path: string; addedLines: string[] }[] {
  const files: { path: string; addedLines: string[] }[] = []
  let current: { path: string; addedLines: string[] } | null = null

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = { path: line.slice(6), addedLines: [] }
      files.push(current)
      continue
    }
    // Skip unified diff header lines and context/deletion lines
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue
    if (current && line.startsWith('+')) {
      current.addedLines.push(line.slice(1))
    }
  }

  return files.filter(f => f.addedLines.length > 0)
}
