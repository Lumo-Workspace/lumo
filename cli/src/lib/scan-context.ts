import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { resolveAuthedApiUrl, trimTrailingSlash } from './api'
import { configDir, readCredentials, type Credentials } from './config'
import { isMissingPluginRoute } from './plugin-route'
import type { ServerPrFinding } from './scan-labels'
import { sanitizeField } from './sanitize'
import { runGit } from './worktree'

/**
 * LUM-1256 — the server context of a local scan: what the Lumo server
 * already knows about the fingerprints `lumo security scan` finds (the
 * default branch's baseline, human rulings, review learnings in scope, the
 * workspace security policy, the branch's open PR), read from
 * `GET /api/workspaces/me/security-scan/context` and cached by ETag under
 * `~/.lumo/cache/scan-context/`. Ids and statuses only — no code.
 *
 * Never fatal: no credentials, no GitHub remote, a server without the
 * security plugin (its HTML 404), a repository not linked to the workspace,
 * or no network all mean "no server context" (or the cached one), and the
 * scan still runs. `--offline` reads the cache only.
 */

/** Mirrors `ScanContextView` (ee/security/services/security-scan-context.service.ts), v1. */
export interface ScanContext {
  version: 1
  repo: string
  baseline: {
    sha: string
    at: string
    partial: boolean
    fingerprints: string[]
  } | null
  rulings: Array<{
    fingerprint: string
    ruleId: string
    disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK'
    by: string | null
    at: string
    pullRequest: number
  }>
  learnings: Array<{
    id: string
    repo: string
    fingerprint: string
    ruleId: string
    pathGlob: string | null
  }>
  learningsScope: string
  policy: {
    block: Array<{
      provenance: 'DETERMINISTIC' | 'EXTERNAL_TOOL'
      severity: 'LOW' | 'MEDIUM' | 'HIGH'
    }>
  }
  pullRequest: { number: number; headSha: string | null } | null
  /** LUM-1330: the name this CLI sent, when the server found the repository
   *  under its current name `repo` (a rename). Absent on an older server. */
  renamedFrom?: string
}

/** Where the context came from: the server now, the cache, or nowhere. */
export type ContextSource = 'live' | 'cache' | 'none'

export interface ScanContextResult {
  source: ContextSource
  /** Why the context is not live (or a degraded live read); null when live. */
  note: string | null
  repo: string | null
  /** When the context was last confirmed by the server (ISO). */
  fetchedAt: string | null
  context: ScanContext | null
}

interface CacheEntry {
  etag: string
  fetchedAt: string
  context: ScanContext
}

export const SCAN_CONTEXT_PATH = '/api/workspaces/me/security-scan/context'

/** A slow server must not hold up a pre-commit hook for long. */
export const SCAN_CONTEXT_TIMEOUT_MS = 8000

export interface ScanContextDeps {
  fetch?: typeof fetch
  readCredentials?: () => Credentials | null
  now?: () => Date
  /** Directory of the cache files (default `~/.lumo/cache/scan-context`). */
  cacheDir?: string
}

/**
 * `owner/name` of a GitHub remote URL (https, ssh or scp form); null for
 * anything else.
 */
export function parseGithubRepo(url: string): string | null {
  const m =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      url.trim()
    )
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

/** The repository the scan belongs to: origin's `owner/name`, or null. */
export function detectRepo(root: string): string | null {
  const r = runGit(['remote', 'get-url', 'origin'], root)
  if (r.status !== 0) return null
  return parseGithubRepo(r.stdout ?? '')
}

/** The checked-out branch, or null on a detached HEAD. */
export function detectBranch(root: string): string | null {
  const r = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root)
  if (r.status !== 0) return null
  const name = (r.stdout ?? '').trim()
  return name === '' ? null : name
}

export function defaultCacheDir(): string {
  return path.join(configDir(), 'cache', 'scan-context')
}

/** One file per (server, workspace, repo, branch). */
export function cacheFile(
  dir: string,
  key: {
    apiUrl: string
    workspaceId: string
    repo: string
    branch: string | null
  }
): string {
  const id = createHash('sha256')
    .update(
      [
        trimTrailingSlash(key.apiUrl),
        key.workspaceId,
        key.repo.toLowerCase(),
        key.branch ?? '',
      ].join('\n')
    )
    .digest('hex')
    .slice(0, 24)
  return path.join(dir, `${id}.json`)
}

/** Loose shape check — a cache file or response of another version is ignored. */
export function isScanContext(v: unknown): v is ScanContext {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    c.version === 1 &&
    typeof c.repo === 'string' &&
    Array.isArray(c.rulings) &&
    Array.isArray(c.learnings) &&
    !!c.policy &&
    Array.isArray((c.policy as { block?: unknown }).block) &&
    (c.baseline === null ||
      Array.isArray((c.baseline as { fingerprints?: unknown })?.fingerprints))
  )
}

export function readCache(file: string): CacheEntry | null {
  try {
    const data = JSON.parse(
      fs.readFileSync(file, 'utf8')
    ) as Partial<CacheEntry>
    if (
      typeof data.etag !== 'string' ||
      typeof data.fetchedAt !== 'string' ||
      !isScanContext(data.context)
    )
      return null
    return data as CacheEntry
  } catch {
    return null
  }
}

/** Best effort: a read-only home (a sandbox) just means no cache next time. */
export function writeCache(file: string, entry: CacheEntry): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch {
    // ignore
  }
}

function none(note: string, repo: string | null): ScanContextResult {
  return { source: 'none', note, repo, fetchedAt: null, context: null }
}

function fromCache(
  entry: CacheEntry | null,
  note: string,
  repo: string
): ScanContextResult {
  if (!entry) return none(note, repo)
  return {
    source: 'cache',
    note: `${note} — using the context cached ${entry.fetchedAt}`,
    repo,
    fetchedAt: entry.fetchedAt,
    context: entry.context,
  }
}

/**
 * The server context of `repo` (and `branch`'s open PR). Never throws.
 */
export async function loadScanContext(
  opts: {
    repo: string | null
    branch: string | null
    offline: boolean
    /** LUM-1258 — `--timeout`: how long to wait for Lumo before the cache. */
    timeoutMs?: number
  },
  deps: ScanContextDeps = {}
): Promise<ScanContextResult> {
  const creds = (deps.readCredentials ?? readCredentials)()
  if (!creds) return none('not logged in (lumo auth login)', opts.repo)
  if (!opts.repo)
    return none('no GitHub origin remote (pass --repo owner/name)', null)
  const repo = opts.repo
  let apiUrl: string
  try {
    apiUrl = resolveAuthedApiUrl(creds.apiUrl, { warn: () => {} })
  } catch (err) {
    return none(err instanceof Error ? err.message : String(err), repo)
  }
  const file = cacheFile(deps.cacheDir ?? defaultCacheDir(), {
    apiUrl,
    workspaceId: creds.workspaceId,
    repo,
    branch: opts.branch,
  })
  const cached = readCache(file)
  if (opts.offline)
    return cached
      ? {
          source: 'cache',
          note: `--offline — using the context cached ${cached.fetchedAt}`,
          repo,
          fetchedAt: cached.fetchedAt,
          context: cached.context,
        }
      : none('--offline and no cached context (run once online)', repo)

  const query = new URLSearchParams({ repo })
  if (opts.branch) query.set('branch', opts.branch)
  const url = `${trimTrailingSlash(apiUrl)}${SCAN_CONTEXT_PATH}?${query}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  if (cached) headers['If-None-Match'] = cached.etag

  let res: Response
  try {
    res = await (deps.fetch ?? fetch)(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? SCAN_CONTEXT_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return fromCache(cached, `could not reach Lumo (${msg})`, repo)
  }
  const now = (deps.now ?? (() => new Date()))().toISOString()

  if (res.status === 304 && cached) {
    const entry = { ...cached, fetchedAt: now }
    writeCache(file, entry)
    return {
      source: 'live',
      note: null,
      repo: currentRepo(cached.context, repo),
      fetchedAt: now,
      context: cached.context,
    }
  }
  if (isMissingPluginRoute(res))
    return none(
      'this Lumo server does not serve scan context (no security plugin, or an older server)',
      repo
    )
  if (res.status === 404)
    return none(`${repo} is not linked to this Lumo workspace`, repo)
  if (res.status === 401 || res.status === 403)
    return none(`Lumo refused the credentials (HTTP ${res.status})`, repo)
  if (!res.ok)
    return fromCache(cached, `Lumo answered HTTP ${res.status}`, repo)

  let body: unknown
  try {
    body = await res.json()
  } catch {
    return fromCache(cached, 'Lumo sent an unreadable context', repo)
  }
  if (!isScanContext(body))
    return fromCache(cached, 'Lumo sent a context of an unknown version', repo)
  const etag = res.headers.get('etag')
  if (etag) writeCache(file, { etag, fetchedAt: now, context: body })
  return {
    source: 'live',
    note: null,
    repo: currentRepo(body, repo),
    fetchedAt: now,
    context: body,
  }
}

/** LUM-1330 — the repository's current name when the server followed a rename. */
function currentRepo(context: ScanContext, sent: string): string {
  return context.renamedFrom ? context.repo : sent
}

/**
 * LUM-1330 — the server found `from` under its current name `to`: say so and
 * how to point the local remote at it.
 */
export function renamedRemoteLines(from: string, to: string): string[] {
  return [
    `Note: ${sanitizeField(from)} was renamed to ${sanitizeField(to)}. Update your git remote:`,
    `  git remote set-url origin https://github.com/${sanitizeField(to)}.git`,
  ]
}

/** The latest server scan of a PR, as `--pr` reads it. */
export type PrScanLoad =
  | {
      ok: true
      headSha: string | null
      findings: ServerPrFinding[]
    }
  | { ok: false; note: string }

/**
 * The latest scan of PR `number` through the same read as `lumo pr show`
 * (`GET /api/pull-requests/<n>/scans`). Never throws.
 */
export async function loadPrScan(
  number: number,
  repo: string,
  deps: ScanContextDeps = {},
  timeoutMs: number = SCAN_CONTEXT_TIMEOUT_MS
): Promise<PrScanLoad> {
  const creds = (deps.readCredentials ?? readCredentials)()
  if (!creds) return { ok: false, note: 'not logged in (lumo auth login)' }
  let res: Response
  try {
    const apiUrl = resolveAuthedApiUrl(creds.apiUrl, { warn: () => {} })
    const url = `${trimTrailingSlash(apiUrl)}/api/pull-requests/${number}/scans?${new URLSearchParams({ repo })}`
    res = await (deps.fetch ?? fetch)(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, note: `could not reach Lumo (${msg})` }
  }
  if (isMissingPluginRoute(res))
    return { ok: false, note: 'this Lumo server has no security plugin' }
  if (!res.ok)
    return {
      ok: false,
      note: `reading PR #${number} failed (HTTP ${res.status})`,
    }
  try {
    const body = (await res.json()) as {
      scans?: Array<{
        headSha?: string
        findings?: ServerPrFinding[]
      }>
    }
    const latest = body.scans?.[0]
    if (!latest) return { ok: false, note: `PR #${number} has no scan yet` }
    return {
      ok: true,
      headSha: latest.headSha ?? null,
      findings: Array.isArray(latest.findings) ? latest.findings : [],
    }
  } catch {
    return { ok: false, note: `PR #${number}: unreadable scan` }
  }
}
