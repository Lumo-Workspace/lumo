/**
 * GitHub read helpers for fetching committed files and PR diffs.
 *
 * Uses raw fetch (same pattern as lib/integrations/github/sync.ts) — no new
 * npm deps. All network calls require a GitHub installation token obtained via
 * getGithubInstallationToken(workspaceId).
 */

import { logger } from '@/lib/logger'
import { getGithubInstallationToken } from './auth'

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lumo-agent/1.0',
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
 * Reads a file from a GitHub repository at a given ref.
 * Returns the decoded UTF-8 content, or null if the file does not exist (404).
 */
export async function readRepoFile(opts: {
  workspaceId: string
  fullName: string
  path: string
  ref?: string
}): Promise<string | null> {
  const token = await getGithubInstallationToken(opts.workspaceId)
  const [owner, repo] = splitFullName(opts.fullName)

  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/contents/${opts.path}`
  )
  if (opts.ref) url.searchParams.set('ref', opts.ref)

  const res = await fetch(url.toString(), {
    headers: {
      ...GH_HEADERS,
      // Request raw content directly — GitHub returns the file bytes as text
      Accept: 'application/vnd.github.raw',
      Authorization: `Bearer ${token}`,
    },
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
  const token = await getGithubInstallationToken(opts.workspaceId)
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
  const token = await getGithubInstallationToken(opts.workspaceId)
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
  const token = await getGithubInstallationToken(opts.workspaceId)
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
