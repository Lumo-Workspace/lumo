/**
 * LUM-738 — the repository security baseline (spec §6 L2 v0.3): the
 * fingerprint set of the default branch's last managed scan, the diff-aware
 * substitute for findings that have no line-level diff. Three entry points:
 *
 *   requestFromPush  a push landed on the default branch → claim + start
 *   ensure           a PR scan on a repo with no (or a stale) baseline →
 *                    resolve the default-branch head, claim + start
 *   persist          the workflow's persist step → write the set
 *
 * The claim (`at: null`, `requestedAt` set) is what keeps a burst of PRs
 * from each starting its own sandbox; it goes stale after
 * `BASELINE_STALE_MS` so a run that died is not a permanent block. Two
 * concurrent claimers can still both start a run — the write is idempotent
 * and the cost is one extra sandbox, not a wrong baseline.
 *
 * Layering: service — the Git platform through the `GitProvider` port, the database
 * through the repository, the workflow through its start wrapper.
 */
import { logger } from '@/lib/logger'
import {
  gitProviderFor,
  gitProviderRefOf,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import type { SecurityBaseline } from '@/ee/security/security-scan/types'
import {
  BASELINE_STALE_MS,
  type BaselineScanJob,
  type BaselineScanOutcome,
} from './security-managed-scan.config'
import { loadSecurityLayers } from './security-workspace-switches.service'
import { startSecurityBaselineScan } from './security-baseline-scan-start'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

export type BaselineRequestOutcome =
  | 'disabled'
  | 'unlinked'
  | 'present'
  | 'in_flight'
  | 'requested'
  | 'start_failed'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A landed baseline, or a claim younger than the stale window. */
export function isBaselineLive(
  baseline: SecurityBaseline | null | undefined,
  now: Date
): 'present' | 'in_flight' | null {
  if (!baseline) return null
  if (baseline.at !== null) return 'present'
  const requested = Date.parse(baseline.requestedAt)
  if (
    Number.isFinite(requested) &&
    now.getTime() - requested < BASELINE_STALE_MS
  )
    return 'in_flight'
  return null
}

async function claimAndStart(
  job: BaselineScanJob,
  now: Date
): Promise<'requested' | 'start_failed'> {
  await securityColumnsRepository.setSecurityBaseline(
    job.workspaceId,
    job.repo,
    {
      sha: job.sha,
      at: null,
      requestedAt: now.toISOString(),
      fingerprints: [],
      partial: false,
      tools: [],
    }
  )
  const runId = await startSecurityBaselineScan(job)
  return runId ? 'requested' : 'start_failed'
}

export const securityBaselineService = {
  /**
   * Default-branch push: always a fresh baseline for the new head (a landed
   * or in-flight one is superseded — the branch moved). Skipped when the
   * managed scan is off (platform env, or the workspace's scan switch —
   * LUM-866) or the repo is not linked in this workspace.
   */
  async requestFromPush(
    job: BaselineScanJob,
    now: Date = new Date()
  ): Promise<BaselineRequestOutcome> {
    if (!(await loadSecurityLayers(job.workspaceId)).managedScan)
      return 'disabled'
    const existing = await securityColumnsRepository.findSecurityBaseline(
      job.workspaceId,
      job.repo
    )
    if (existing === undefined) return 'unlinked'
    if (existing?.at === null && isBaselineLive(existing, now) === 'in_flight')
      return 'in_flight'
    return claimAndStart(job, now)
  },

  /**
   * Lazy build from a PR scan: only when the repo has no live baseline.
   * Resolves the default branch's current head through GitHub, then claims
   * and starts. Never throws — the caller is stage A, which must not fail
   * a PR scan over the baseline.
   */
  async ensure(
    opts: { workspaceId: string; repo: string } & GitProviderRef,
    now: Date = new Date()
  ): Promise<BaselineRequestOutcome> {
    try {
      if (!(await loadSecurityLayers(opts.workspaceId)).managedScan)
        return 'disabled'
      const existing = await securityColumnsRepository.findSecurityBaseline(
        opts.workspaceId,
        opts.repo
      )
      if (existing === undefined) return 'unlinked'
      const live = isBaselineLive(existing, now)
      if (live) return live
      const head = await gitProviderFor(opts).fetchDefaultBranchHead({
        workspaceId: opts.workspaceId,
        fullName: opts.repo,
      })
      return await claimAndStart(
        {
          ...gitProviderRefOf(opts),
          workspaceId: opts.workspaceId,
          repo: opts.repo,
          sha: head.sha,
        },
        now
      )
    } catch (error) {
      logger.warn(
        `[security-baseline] ensure failed ${opts.repo}: ${message(error).slice(0, 200)}`
      )
      return 'start_failed'
    }
  },

  /**
   * The persist step: write the set. `requestedAt` is carried over from the
   * claim when it is the same sha (so the panel can show how long the run
   * took); a baseline for a newer sha than the claim still wins — the set is
   * what matters. Errors propagate so the step retries.
   */
  async persist(
    job: BaselineScanJob,
    outcome: BaselineScanOutcome,
    now: Date = new Date()
  ): Promise<number> {
    const existing = await securityColumnsRepository.findSecurityBaseline(
      job.workspaceId,
      job.repo
    )
    const requestedAt =
      existing?.sha === job.sha ? existing.requestedAt : now.toISOString()
    const count = await securityColumnsRepository.setSecurityBaseline(
      job.workspaceId,
      job.repo,
      {
        sha: job.sha,
        at: now.toISOString(),
        requestedAt,
        fingerprints: outcome.fingerprints,
        partial: outcome.partial,
        tools: outcome.tools,
      }
    )
    logger.info(
      `[security-baseline] ${job.repo}@${job.sha.slice(0, 7)}: ${outcome.fingerprints.length} fingerprints tools=${outcome.tools.join(',')}${outcome.partial ? ' partial' : ''}${outcome.failed.length ? ` failed=${outcome.failed.join(';').slice(0, 200)}` : ''}${outcome.skipped.length ? ` skipped=${outcome.skipped.join(',')}` : ''} rows=${count}`
    )
    return count
  },
}
