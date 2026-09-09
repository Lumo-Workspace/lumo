/**
 * GitHub security-alert readers for the external oracle (LUM-735).
 *
 * Lumo does not run a scanner; it CONSUMES what GitHub already aggregates —
 * code-scanning alerts (any tool that uploads SARIF: Semgrep, CodeQL,
 * gitleaks, …) and secret-scanning alerts. Raw fetch, no new npm deps, same
 * shape as ./checks. Each function returns `configured: false` on 403/404 —
 * a repo without Advanced Security / code scanning is a *state* the panel
 * must show, not an error — and throws on anything else so the caller can
 * mark the stage FAILED rather than pretend it ran.
 *
 * Nothing here retains the alert payload: every response is reduced to the
 * handful of fields Lumo keeps before it is returned, and the secret-scanning
 * `secret` field is never read at all (spec P8 / R5).
 */
import { logger } from '@/lib/logger'
import { getGithubInstallationToken } from './auth'
import type {
  CodeScanningAlert,
  SecretScanningAlert,
} from '@/lib/security-scan/types'

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lumo-agent/1.0',
}

/** One page; a full page is reported as `truncated` instead of paginating. */
export const ALERTS_PAGE_SIZE = 100
/** Location lookups are one request per alert — bounded per scan. */
export const MAX_SECRET_ALERT_LOCATIONS = 20

export type AlertsResult<T> =
  | { configured: false; reason: string }
  | { configured: true; alerts: T[]; truncated: boolean }

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

type GhOk = { kind: 'ok'; body: unknown }
type GhNotConfigured = { kind: 'not_configured'; reason: string }

/**
 * GET with the installation token. 403/404 → not_configured (GitHub uses
 * both for "this feature is off here": 403 "Advanced Security must be
 * enabled…", 404 "no analysis found" / "Secret scanning is disabled").
 * Any other non-2xx throws with `status`.
 */
async function ghGet(
  url: string,
  token: string
): Promise<GhOk | GhNotConfigured> {
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  })
  if (res.status === 403 || res.status === 404) {
    let reason = `GitHub API ${res.status}`
    try {
      const body = asRecord(await res.json())
      reason = str(body?.['message']) ?? reason
    } catch {
      // body not JSON — keep the status-only reason
    }
    return { kind: 'not_configured', reason }
  }
  if (!res.ok) {
    throw Object.assign(new Error(`GitHub API ${res.status} for ${url}`), {
      status: res.status,
    })
  }
  return { kind: 'ok', body: await res.json() }
}

function toCodeScanningAlert(raw: unknown): CodeScanningAlert | null {
  const r = asRecord(raw)
  const number = num(r?.['number'])
  const htmlUrl = str(r?.['html_url'])
  if (number === null || !htmlUrl) return null
  const rule = asRecord(r?.['rule'])
  const tool = asRecord(r?.['tool'])
  const instance = asRecord(r?.['most_recent_instance'])
  const location = asRecord(instance?.['location'])
  const message = asRecord(instance?.['message'])
  const level = str(rule?.['security_severity_level'])
  const severity = str(rule?.['severity'])
  return {
    number,
    htmlUrl,
    toolName: str(tool?.['name']) ?? 'unknown',
    ruleId: str(rule?.['id']) ?? 'unknown',
    ruleDescription: str(rule?.['description']),
    securitySeverityLevel:
      level === 'low' ||
      level === 'medium' ||
      level === 'high' ||
      level === 'critical'
        ? level
        : null,
    severity:
      severity === 'note' || severity === 'warning' || severity === 'error'
        ? severity
        : null,
    path: str(location?.['path']),
    startLine: num(location?.['start_line']),
    messageText: str(message?.['text']),
  }
}

/**
 * Open code-scanning alerts GitHub attributes to this PR (`pr=` is GitHub's
 * own diff filter; the service narrows further to changed files).
 */
export async function fetchCodeScanningAlerts(opts: {
  workspaceId: string
  fullName: string
  prNumber: number
}): Promise<AlertsResult<CodeScanningAlert>> {
  const token = await getGithubInstallationToken(opts.workspaceId)
  const [owner, repo] = splitFullName(opts.fullName)
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/code-scanning/alerts`
  )
  url.searchParams.set('pr', String(opts.prNumber))
  url.searchParams.set('state', 'open')
  url.searchParams.set('per_page', String(ALERTS_PAGE_SIZE))
  const res = await ghGet(url.toString(), token)
  if (res.kind === 'not_configured') {
    logger.info(
      `[github/code-scanning] ${opts.fullName}: code scanning not configured (${res.reason})`
    )
    return { configured: false, reason: res.reason }
  }
  const raw = asArray(res.body)
  const alerts: CodeScanningAlert[] = []
  for (const item of raw) {
    const a = toCodeScanningAlert(item)
    if (a) alerts.push(a)
  }
  return { configured: true, alerts, truncated: raw.length >= ALERTS_PAGE_SIZE }
}

/**
 * Commit-location paths for one secret-scanning alert. A failed lookup is
 * logged and yields [] — the alert still counts, it just cannot be tied to a
 * file, so it will not upgrade anything.
 */
async function fetchSecretAlertPaths(
  owner: string,
  repo: string,
  alertNumber: number,
  token: string
): Promise<string[]> {
  try {
    const res = await ghGet(
      `https://api.github.com/repos/${owner}/${repo}/secret-scanning/alerts/${alertNumber}/locations?per_page=${ALERTS_PAGE_SIZE}`,
      token
    )
    if (res.kind === 'not_configured') return []
    const paths = new Set<string>()
    for (const item of asArray(res.body)) {
      const loc = asRecord(item)
      if (str(loc?.['type']) !== 'commit') continue
      const path = str(asRecord(loc?.['details'])?.['path'])
      if (path) paths.add(path)
    }
    return [...paths]
  } catch (error) {
    logger.warn(
      `[github/code-scanning] locations lookup failed for ${owner}/${repo} alert ${alertNumber}:`,
      error instanceof Error ? error.message : error
    )
    return []
  }
}

/**
 * Open secret-scanning alerts GitHub has VERIFIED as active. Used only to
 * upgrade Lumo's own pattern hits (A1) — never persisted as findings of
 * their own. The `secret` field of the payload is not read.
 */
export async function fetchActiveSecretScanningAlerts(opts: {
  workspaceId: string
  fullName: string
}): Promise<AlertsResult<SecretScanningAlert>> {
  const token = await getGithubInstallationToken(opts.workspaceId)
  const [owner, repo] = splitFullName(opts.fullName)
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/secret-scanning/alerts`
  )
  url.searchParams.set('state', 'open')
  url.searchParams.set('validity', 'active')
  url.searchParams.set('per_page', String(ALERTS_PAGE_SIZE))
  const res = await ghGet(url.toString(), token)
  if (res.kind === 'not_configured') {
    logger.info(
      `[github/code-scanning] ${opts.fullName}: secret scanning not configured (${res.reason})`
    )
    return { configured: false, reason: res.reason }
  }
  const active = asArray(res.body)
    .map(asRecord)
    .filter(
      (r): r is Record<string, unknown> =>
        r !== null && str(r['validity']) === 'active'
    )
  const capped = active.slice(0, MAX_SECRET_ALERT_LOCATIONS)
  const alerts: SecretScanningAlert[] = []
  for (const r of capped) {
    const number = num(r['number'])
    const htmlUrl = str(r['html_url'])
    if (number === null || !htmlUrl) continue
    alerts.push({
      number,
      htmlUrl,
      secretType: str(r['secret_type']) ?? 'unknown',
      secretTypeDisplayName:
        str(r['secret_type_display_name']) ?? str(r['secret_type']) ?? 'secret',
      paths: await fetchSecretAlertPaths(owner, repo, number, token),
    })
  }
  return {
    configured: true,
    alerts,
    truncated: active.length > MAX_SECRET_ALERT_LOCATIONS,
  }
}
