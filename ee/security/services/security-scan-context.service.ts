/**
 * LUM-1256 — a repository's server context for `lumo security scan`: what
 * the server already knows about the fingerprints a local scan finds, so
 * the CLI can label each one (new / already on main / ruled / matched by a
 * learning) and say whether it would block DONE under the workspace's real
 * policy. Read-only.
 *
 * What it returns is ids, fingerprints, rule ids and statuses only — never
 * a finding's code, evidence or note, never a learning's text. A secret's
 * fingerprint is a truncated hash of rule + value (`sha256(...).slice(0,
 * 16)`), already shown to the same members by `lumo pr show`.
 *
 * - baseline   the default branch's last managed-scan fingerprint set
 *              (null when none has landed — an in-flight claim has no set).
 * - rulings    the newest human ruling per fingerprint on any of the
 *              repository's PRs (a later reopen withdraws it), with who,
 *              when and on which PR. The server copies a ruling only onto
 *              later findings of the SAME PR (inherit-dispositions.ts), so
 *              the PR number is what tells the CLI whether it carries over.
 * - learnings  the ACTIVE PR-review learnings in scope (LUM-1131): this
 *              repository's, plus the workspace's other repositories' when
 *              the learnings scope reads them (LUM-1134); a learning still
 *              scoped to an unmerged PR counts only for that PR.
 * - policy     the workspace security policy (`parseSecurityPolicy`).
 *
 * Layering: service — the database through repositories, GitHub (repo
 * visibility, `auto` scope only) through an injectable reader.
 */
import { memberRepository } from '@/lib/repositories/member.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { createSlidingWindowRateLimiter } from '@/lib/services/sliding-window-rate-limit'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import {
  securityScanContextRepository,
  type RulingRow,
} from '@/ee/security/repositories/security-scan-context.repository'
import {
  parseSecurityPolicy,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'
import {
  readsOtherRepositories,
  type LearningsScope,
  type RepoVisibility,
} from '@/ee/security/security-scan/learnings-scope'
import { learningInScope } from '@/ee/security/security-scan/thread-reply'
import type { RepoVisibilityReader } from '@/ee/security/services/review-learnings.service'

export const SCAN_CONTEXT_VERSION = 1

/** Ruling rows read (newest first) before keeping one per fingerprint. */
export const SCAN_CONTEXT_RULING_ROWS = 2000

/** Learnings read per side (this repository / the others). */
export const SCAN_CONTEXT_LEARNINGS = 200

export const SCAN_CONTEXT_RATE_LIMIT = { max: 30, windowMs: 60_000 }

export type RulingDisposition = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'

export interface ScanContextRuling {
  fingerprint: string
  ruleId: string
  disposition: RulingDisposition
  /** Who ruled (display name); null for a system ruling. */
  by: string | null
  at: string
  /** The PR the ruling was recorded on. */
  pullRequest: number
}

export interface ScanContextLearning {
  /** The learning's memory id (`lumo memory show <id>`). */
  id: string
  repo: string
  fingerprint: string
  ruleId: string
  pathGlob: string | null
}

export interface ScanContextView {
  version: typeof SCAN_CONTEXT_VERSION
  repo: string
  baseline: {
    sha: string
    at: string
    partial: boolean
    fingerprints: string[]
  } | null
  rulings: ScanContextRuling[]
  learnings: ScanContextLearning[]
  learningsScope: LearningsScope
  policy: SecurityPolicy
  /** The branch's open PR (only when a branch was asked about). */
  pullRequest: { number: number; headSha: string | null } | null
}

const limiter = createSlidingWindowRateLimiter({
  prefix: 'scan-context:rate',
  max: SCAN_CONTEXT_RATE_LIMIT.max,
  windowMs: SCAN_CONTEXT_RATE_LIMIT.windowMs,
  logTag: 'security-scan-context-rate-limit',
})

/** 429 once a member asks more than 30 times a minute. */
export async function checkScanContextRateLimit(key: string): Promise<void> {
  if (!(await limiter.check(key))) {
    throw Object.assign(
      new Error(`Rate limit exceeded (${SCAN_CONTEXT_RATE_LIMIT.max} req/min)`),
      { status: 429 }
    )
  }
}

/** Test-only: reset module-level state between test cases. */
export function __resetScanContextRateLimitForTests(): void {
  limiter.reset()
}

/**
 * The newest row per fingerprint decides (rows come newest first); a reopen
 * marker (disposition null) withdraws the ruling. Pure.
 */
export function latestRulings(
  rows: RulingRow[]
): Array<RulingRow & { disposition: RulingDisposition }> {
  const seen = new Set<string>()
  const out: Array<RulingRow & { disposition: RulingDisposition }> = []
  for (const r of rows) {
    if (seen.has(r.fingerprint)) continue
    seen.add(r.fingerprint)
    if (r.disposition !== null) out.push({ ...r, disposition: r.disposition })
  }
  return out
}

const readRepoVisibility: RepoVisibilityReader = async opts => {
  // Dynamic import keeps the GitHub App auth (ESM) out of the static graph.
  const { fetchRepoVisibility } =
    await import('@/lib/integrations/github/contents')
  return fetchRepoVisibility(opts)
}

/** The ACTIVE learnings a review of this repository would read, keys only. */
async function learningsInScope(
  workspaceId: string,
  repo: string,
  scope: LearningsScope,
  openPullRequestId: string | null,
  deps: { repoVisibility?: RepoVisibilityReader }
): Promise<ScanContextLearning[]> {
  const [own, others] = await Promise.all([
    prReviewLearningRepository.findActiveKeys(
      workspaceId,
      repo,
      'own',
      SCAN_CONTEXT_LEARNINGS
    ),
    scope === 'local'
      ? Promise.resolve([])
      : prReviewLearningRepository.findActiveKeys(
          workspaceId,
          repo,
          'others',
          SCAN_CONTEXT_LEARNINGS
        ),
  ])
  let readOthers = others.length > 0
  if (readOthers && scope === 'auto') {
    const visibility = await (deps.repoVisibility ?? readRepoVisibility)({
      workspaceId,
      fullName: repo,
    }).catch((): RepoVisibility => 'unknown')
    readOthers = readsOtherRepositories(scope, visibility)
  }
  const rows = readOthers ? [...own, ...others] : own
  const sourceIds = [
    ...new Set(
      rows.flatMap(r =>
        !r.repoWideAt && r.sourcePullRequestId ? [r.sourcePullRequestId] : []
      )
    ),
  ]
  const states = await pullRequestRepository.findStatesByIds(
    workspaceId,
    sourceIds
  )
  return rows
    .filter(r =>
      learningInScope(
        r,
        // No open PR: only repository-wide learnings apply.
        openPullRequestId ?? '',
        r.sourcePullRequestId ? states.get(r.sourcePullRequestId) : undefined
      )
    )
    .map(r => ({
      id: r.memoryId,
      repo: r.repo,
      fingerprint: r.fingerprint,
      ruleId: r.ruleId,
      pathGlob: r.pathGlob,
    }))
}

export const securityScanContextService = {
  /**
   * The context of `repo` (owner/name) in the caller's workspace. 404 when
   * the repository is not linked to a project of this workspace — a repo of
   * another workspace is indistinguishable from one that does not exist.
   */
  async getForRepo(
    workspaceId: string,
    input: { repo: string; branch?: string | undefined },
    deps: { repoVisibility?: RepoVisibilityReader } = {}
  ): Promise<ScanContextView> {
    const baseline = await securityColumnsRepository.findSecurityBaseline(
      workspaceId,
      input.repo
    )
    if (baseline === undefined) {
      throw Object.assign(
        new Error('Repository not linked to this workspace'),
        { status: 404 }
      )
    }
    const [scope, policyJson, rulingRows, openPr] = await Promise.all([
      securityColumnsRepository.findLearningsScope(workspaceId),
      securityColumnsRepository.findSecurityPolicy(workspaceId),
      securityScanContextRepository.findRulingRows(
        workspaceId,
        input.repo,
        SCAN_CONTEXT_RULING_ROWS
      ),
      input.branch
        ? securityScanContextRepository.findOpenPullRequestByBranch(
            workspaceId,
            input.repo,
            input.branch
          )
        : Promise.resolve(null),
    ])

    const rulings = latestRulings(rulingRows)
    const memberIds = [
      ...new Set(
        rulings.flatMap(r => (r.dispositionedById ? [r.dispositionedById] : []))
      ),
    ]
    const [names, learnings] = await Promise.all([
      memberRepository.labelsByIds(memberIds),
      learningsInScope(
        workspaceId,
        input.repo,
        scope,
        openPr?.id ?? null,
        deps
      ),
    ])

    return {
      version: SCAN_CONTEXT_VERSION,
      repo: input.repo,
      baseline:
        baseline && baseline.at !== null
          ? {
              sha: baseline.sha,
              at: baseline.at,
              partial: baseline.partial,
              fingerprints: [...baseline.fingerprints].sort(),
            }
          : null,
      rulings: rulings.map(r => ({
        fingerprint: r.fingerprint,
        ruleId: r.ruleId,
        disposition: r.disposition,
        by: r.dispositionedById
          ? (names.get(r.dispositionedById) ?? null)
          : null,
        at: r.dispositionedAt.toISOString(),
        pullRequest: r.pullRequestNumber,
      })),
      learnings,
      learningsScope: scope,
      policy: parseSecurityPolicy(policyJson),
      pullRequest: openPr
        ? { number: openPr.number, headSha: openPr.headSha }
        : null,
    }
  },
}
