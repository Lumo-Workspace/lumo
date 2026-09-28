/**
 * GitHub CI signal reader (LUM-616). Pulls a commit's CI state straight from
 * GitHub across BOTH surfaces a provider can use to report on a commit:
 *   - the Checks API (check-runs)  — GitHub Actions, Vercel, modern apps
 *   - the Commit Status API        — Travis, Jenkins, classic CircleCI, …
 * and merges them into one provider-agnostic list. This is the independent
 * harness: the signal is produced on the CI runner, not scraped from the agent's
 * own tool runs, so it cannot be skipped or faked by the agent.
 *
 * Raw fetch, no new npm deps (same pattern as ./contents). The two endpoints are
 * fetched independently — one failing never suppresses the other.
 */

import { logger } from '@/lib/logger'
import { getRepoToken } from './auth'

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lumo-agent/1.0',
}

/**
 * Coarse, provider-agnostic outcome. `skip` = not a pass/fail signal yet.
 * `not_run` (LUM-838) = the check completed without ever executing (billing
 * block, no runner, startup failure, cancelled) — a lost run is never a
 * verdict, so it must not be read as a failure.
 */
export type CiOutcome = 'success' | 'failure' | 'skip' | 'not_run'

export interface CiSignal {
  /** The check-run name (Checks API) or the status context (Status API). */
  name: string
  outcome: CiOutcome
  detailsUrl: string | null
  source: 'github_check' | 'github_status'
  /** Why the check never executed; present only when `outcome` is `not_run`. */
  notRunReason?: string
}

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

/** check-run conclusions that mean the check never executed to a result. */
const NOT_RUN_CONCLUSIONS = new Set([
  'startup_failure',
  'cancelled',
  'stale',
  'action_required',
])

/** check-run conclusion → outcome. Unfinished/neutral conclusions are `skip`. */
function checkRunOutcome(conclusion: string | null): CiOutcome {
  if (conclusion === 'success') return 'success'
  if (
    conclusion === null ||
    conclusion === 'neutral' ||
    conclusion === 'skipped'
  ) {
    return 'skip'
  }
  if (NOT_RUN_CONCLUSIONS.has(conclusion)) return 'not_run'
  return 'failure' // failure | timed_out
}

/** commit-status state → outcome. `pending` is not yet a verdict → `skip`. */
function statusOutcome(state: string): CiOutcome {
  if (state === 'success') return 'success'
  if (state === 'pending') return 'skip'
  return 'failure' // failure | error
}

async function ghJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw Object.assign(new Error(`GitHub API ${res.status} for ${url}`), {
      status: res.status,
    })
  }
  return res.json()
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

/**
 * LUM-838: an Actions job the platform refused to start (billing/spending-limit
 * block, no runner) still completes with conclusion `failure`, but it has no
 * runner and zero steps. Returns true only when the job record positively shows
 * that; a lookup error returns false so the check keeps its failure mapping.
 */
async function actionsJobNeverStarted(
  repoBase: string,
  jobId: number,
  token: string
): Promise<boolean> {
  try {
    const job = asRecord(
      await ghJson(`${repoBase}/actions/jobs/${jobId}`, token)
    )
    if (!job) return false
    return asArray(job['steps']).length === 0 && !str(job['runner_name'])
  } catch (err) {
    logger.warn(
      `[github/checks] actions job ${jobId} lookup failed, keeping failure: ${err}`
    )
    return false
  }
}

const NEVER_STARTED_FALLBACK =
  'the job never started (no runner was assigned and no steps ran)'

/** GitHub's own explanation — the first failure-level check-run annotation. */
async function notStartedReason(
  repoBase: string,
  checkRunId: number,
  token: string
): Promise<string> {
  try {
    const annotations = asArray(
      await ghJson(`${repoBase}/check-runs/${checkRunId}/annotations`, token)
    )
    for (const a of annotations) {
      const rec = asRecord(a)
      const message = str(rec?.['message'])
      if (rec?.['annotation_level'] === 'failure' && message) return message
    }
  } catch (err) {
    logger.warn(
      `[github/checks] annotations lookup failed for check run ${checkRunId}: ${err}`
    )
  }
  return NEVER_STARTED_FALLBACK
}

async function checkRunSignal(
  r: Record<string, unknown> | null,
  repoBase: string,
  token: string
): Promise<CiSignal | null> {
  const name = str(r?.['name'])
  if (!name) return null
  const conclusion = str(r?.['conclusion'])
  const signal: CiSignal = {
    name,
    outcome: checkRunOutcome(conclusion),
    detailsUrl: str(r?.['details_url']) ?? str(r?.['html_url']),
    source: 'github_check',
  }
  if (signal.outcome === 'not_run') {
    signal.notRunReason = `check run concluded ${conclusion}`
    return signal
  }
  // For GitHub Actions the check-run id is the job id.
  const id = r?.['id']
  const isActions = asRecord(r?.['app'])?.['slug'] === 'github-actions'
  if (
    signal.outcome === 'failure' &&
    isActions &&
    typeof id === 'number' &&
    (await actionsJobNeverStarted(repoBase, id, token))
  ) {
    signal.outcome = 'not_run'
    signal.notRunReason = await notStartedReason(repoBase, id, token)
  }
  return signal
}

/**
 * Read every CI signal GitHub exposes for a commit (check-runs + commit
 * statuses), merged. Each surface is fetched independently; if one errors it is
 * logged and skipped, and the other source's signals are still returned.
 */
export async function fetchCommitCiSignals(opts: {
  workspaceId: string
  fullName: string
  sha: string
}): Promise<CiSignal[]> {
  const token = await getRepoToken(opts.workspaceId, opts.fullName)
  const [owner, repo] = splitFullName(opts.fullName)
  const repoBase = `https://api.github.com/repos/${owner}/${repo}`
  const base = `${repoBase}/commits/${opts.sha}`

  const [checksRes, statusRes] = await Promise.allSettled([
    ghJson(`${base}/check-runs`, token),
    ghJson(`${base}/status`, token),
  ])

  const signals: CiSignal[] = []

  if (checksRes.status === 'fulfilled') {
    const runs = asArray(asRecord(checksRes.value)?.['check_runs'])
    const checkSignals = await Promise.all(
      runs.map(run => checkRunSignal(asRecord(run), repoBase, token))
    )
    for (const signal of checkSignals) if (signal) signals.push(signal)
  } else {
    logger.error(
      `[github/checks] check-runs fetch failed for ${opts.fullName}@${opts.sha}: ${checksRes.reason}`
    )
  }

  if (statusRes.status === 'fulfilled') {
    for (const s of asArray(asRecord(statusRes.value)?.['statuses'])) {
      const st = asRecord(s)
      const context = str(st?.['context'])
      const state = str(st?.['state'])
      if (!context || !state) continue
      signals.push({
        name: context,
        outcome: statusOutcome(state),
        detailsUrl: str(st?.['target_url']),
        source: 'github_status',
      })
    }
  } else {
    logger.error(
      `[github/checks] status fetch failed for ${opts.fullName}@${opts.sha}: ${statusRes.reason}`
    )
  }

  return signals
}

/**
 * LUM-623: resolve which PR(s) a commit belongs to straight from GitHub. Used as
 * a fallback when a commit-status event arrives with no head branch — a
 * squash-merge deletes the PR branch, so the status payload's `branches` is
 * empty and branch-based resolution can't place the signal. The commit → PR
 * association endpoint still works after merge, so it recovers the linkage that
 * would otherwise be lost. Returns PR numbers (newest-relevant first, as GitHub
 * orders them); [] when the commit maps to no PR.
 */
export async function fetchPullNumbersForCommit(opts: {
  workspaceId: string
  fullName: string
  sha: string
}): Promise<number[]> {
  const token = await getRepoToken(opts.workspaceId, opts.fullName)
  const [owner, repo] = splitFullName(opts.fullName)
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${opts.sha}/pulls`
  const pulls = asArray(await ghJson(url, token))
  const numbers: number[] = []
  for (const pull of pulls) {
    const n = asRecord(pull)?.['number']
    if (typeof n === 'number') numbers.push(n)
  }
  return numbers
}
