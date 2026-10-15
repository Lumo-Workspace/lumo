/**
 * LUM-1148 — runs a PR's pre-merge checks and stores the results on its
 * scan row (`PrSecurityScan.preMergeChecks`); the PR write-back
 * (`security-pr-review.service.ts`) renders them and the verdict reads them.
 *
 * Per reviewed head, from the scan worker (`runForScan`), and again when the
 * PR's title or description changes (`recheckAfterEdit` — a title is fixed
 * by an edit, not a push). Never throws: a failed read or model call makes
 * the checks inconclusive, and an inconclusive check never blocks — but it
 * never replaces an earlier failure of the same head either
 * (`keepEarlierFailures`), so a transient failure never unblocks approval.
 *
 * What the checks are: the repository's Lumo setting with `.lumo.yaml` on
 * the PR's BASE commit applied over it, key by key (repo-config.ts). Cost is
 * bounded: one model call per head (all checks together), the diff
 * path-filtered, secret-masked (`guardInjectedText`), then cut to
 * `PRE_MERGE_DIFF_MAX_CHARS` (masked before the cut, so a credential the
 * cut runs through is never sent half-unmasked), and nothing at all when
 * every check is off.
 *
 * LUM-1149 — the linked task / issue assessment is one of these checks: its
 * requirements are gathered first (`linkedRequirementsService`); none ⇒ it
 * is not applicable and is left out of the model call (a PR whose only
 * enabled check has nothing linked makes no call at all). Its requirements
 * ride in the same call as material, answered one by one.
 *
 * Layering: service — GitHub through `@/lib/integrations/github/*` (loaded
 * lazily), the database through repositories, the model client by dynamic
 * import.
 */
import { logger } from '@/lib/logger'
import { guardInjectedText } from '@/lib/security-scan/inject-guard'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import { linkedRequirementsService } from '@/ee/security/services/linked-requirements.service'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { authoredDescription } from '@/ee/security/security-scan/pr-description-summary'
import { prCommandHandle } from '@/ee/security/services/pr-command-parse'
import {
  effectiveReviewConfig,
  preMergeChecksOf,
} from '@/ee/security/security-scan/repo-config'
import {
  filterReviewableDiff,
  reviewablePathPredicate,
} from '@/ee/security/security-scan/reviewable-path'
import {
  BUILTIN_PRE_MERGE_CHECKS,
  checksForHead,
  inconclusiveResults,
  keepEarlierFailures,
  notApplicableResult,
  planPreMergeChecks,
  resultsFromAnswers,
  unansweredRequirementsByCheck,
  withRequirementAnswers,
  type BuiltinPreMergeCheck,
  type ChecksAnswer,
  type PreMergeCheckGatherInput,
  type PreMergeCheckResult,
  type PreMergeChecksRecord,
  type PreMergeChecksSetting,
} from '@/ee/security/security-scan/pre-merge-checks'
import {
  requirementsMaterial,
  type LinkedRequirement,
} from '@/ee/security/security-scan/issue-assessment'

/**
 * LUM-1149 — the built-ins as the runner uses them: the pure registry with
 * the requirements gatherer wired onto every check that assesses them.
 */
export const RUNNER_BUILTINS: readonly BuiltinPreMergeCheck[] =
  BUILTIN_PRE_MERGE_CHECKS.map(b =>
    b.assessesRequirements
      ? { ...b, requirements: linkedRequirementsService.gather }
      : b
  )

/** The diff the checks read, at most (after path filters and the mask). */
export const PRE_MERGE_DIFF_MAX_CHARS = 40_000
/** The PR description / template the checks read, at most. */
export const PRE_MERGE_TEXT_MAX_CHARS = 8_000
export const PRE_MERGE_TIMEOUT_MS = 60_000

/** Ops switch: `LUMO_PRE_MERGE_CHECKS=off` stops every check run. */
export function isPreMergeChecksEnabled(): boolean {
  return process.env.LUMO_PRE_MERGE_CHECKS?.trim().toLowerCase() !== 'off'
}

async function github() {
  return import('@/lib/integrations/github/contents')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cap(text: string, max: number): { text: string; cut: boolean } {
  return text.length <= max
    ? { text, cut: false }
    : { text: text.slice(0, max), cut: true }
}

export interface ChecksTarget {
  scanId: string
  pullRequestId: string
  workspaceId: string
  repo: string
  prNumber: number
  headSha: string
}

export interface ResolvedPreMergeSetting {
  setting: PreMergeChecksSetting
  pathFilters: string[]
}

export const preMergeChecksService = {
  /**
   * The repository's checks: its Lumo setting, `.lumo.yaml` at `baseSha`
   * applied over it. A failed settings read falls back to the defaults.
   */
  async resolveSetting(input: {
    workspaceId: string
    repo: string
    baseSha: string | null
  }): Promise<ResolvedPreMergeSetting> {
    let row:
      | Awaited<
          ReturnType<typeof repoReviewSettingRepository.findSettings>
        >[number]
      | undefined
    try {
      ;[row] = await repoReviewSettingRepository.findSettings(
        [input.workspaceId],
        input.repo.toLowerCase()
      )
    } catch (error) {
      logger.warn(
        `[pre-merge-checks] settings unavailable repo=${input.repo}: ${describe(error)}`
      )
    }
    const file = await repoConfigService.fileForDecision({
      workspaceId: input.workspaceId,
      repo: input.repo,
      baseSha: input.baseSha,
    })
    const values = { ...DEFAULT_REPO_REVIEW_SETTING, ...(row ?? {}) }
    const e = effectiveReviewConfig({ values, stored: row !== undefined }, file)
    return {
      // LUM-1149: the privacy switch only ever comes from the stored setting.
      setting: preMergeChecksOf(e, {
        taskDetailsOnPublicRepos:
          row !== undefined &&
          values.preMergeChecks.issueAssessment.taskDetailsOnPublicRepos,
      }),
      pathFilters: e.pathFilters.value,
    }
  },

  /**
   * Run the checks for one scan's head and store the results (null when
   * every check is off). Never throws; returns what was stored.
   */
  async run(
    target: ChecksTarget,
    diff: string | null,
    builtins: readonly BuiltinPreMergeCheck[] = RUNNER_BUILTINS
  ): Promise<PreMergeChecksRecord | null> {
    const where = `scan=${target.scanId} pr=#${target.prNumber}`
    if (!isPreMergeChecksEnabled()) return null
    let record: PreMergeChecksRecord | null = null
    try {
      const gh = await github()
      const pr = await gh.fetchPrDetails({
        workspaceId: target.workspaceId,
        fullName: target.repo,
        prNumber: target.prNumber,
      })
      const { setting, pathFilters } =
        await preMergeChecksService.resolveSetting({
          workspaceId: target.workspaceId,
          repo: target.repo,
          baseSha: pr.baseSha,
        })
      const wantsTemplate = setting.description.mode !== 'off'
      let template: string | null = null
      if (wantsTemplate && pr.baseSha) {
        try {
          template = await gh.readPrTemplate({
            workspaceId: target.workspaceId,
            fullName: target.repo,
            ref: pr.baseSha,
          })
        } catch (error) {
          logger.info(
            `[pre-merge-checks] template unreadable ${where}: ${describe(error)}`
          )
        }
      }
      // LUM-1151: the description check reads the author's text, never
      // Lumo's own summary section.
      const input = {
        title: pr.title,
        body: authoredDescription(pr.body, prCommandHandle()),
        template,
      }
      const planned = planPreMergeChecks(setting, input, builtins)
      if (planned.length === 0) {
        await prSecurityScanRepository.setPreMergeChecks(target.scanId, null)
        return null
      }
      const ranAt = new Date().toISOString()
      const gatherInput: PreMergeCheckGatherInput = {
        workspaceId: target.workspaceId,
        repo: target.repo,
        prNumber: target.prNumber,
        pullRequestId: target.pullRequestId,
        baseSha: pr.baseSha,
        headSha: target.headSha,
        pr: input,
        setting,
      }
      // LUM-1149: what each requirements check judges. Nothing linked ⇒ not
      // applicable (left out of the call); a failed read ⇒ inconclusive.
      const linked = new Map<string, LinkedRequirement[]>()
      const notApplicable = new Map<string, PreMergeCheckResult>()
      const unreadable = new Set<string>()
      for (const p of planned) {
        if (!p.assessesRequirements) continue
        try {
          const reqs = p.requirements ? await p.requirements(gatherInput) : []
          if (reqs.length > 0) linked.set(p.id, reqs)
          else notApplicable.set(p.id, notApplicableResult(p))
        } catch (error) {
          unreadable.add(p.id)
          logger.warn(
            `[pre-merge-checks] requirements unreadable ${where}: ${describe(error)}`
          )
        }
      }
      const judged = planned.filter(
        p => !notApplicable.has(p.id) && !unreadable.has(p.id)
      )
      const inOrder = (rs: readonly PreMergeCheckResult[]) => {
        const byId = new Map(rs.map(r => [r.id, r]))
        return planned.map(
          p =>
            notApplicable.get(p.id) ??
            byId.get(p.id) ??
            inconclusiveResults(
              [p],
              'Lumo could not read the linked task or issue this time.'
            )[0]!
        )
      }
      // One model call for every check left to judge.
      const judge = async (): Promise<PreMergeCheckResult[]> => {
        const rawDiff =
          diff ??
          (await gh.fetchPrDiff({
            workspaceId: target.workspaceId,
            fullName: target.repo,
            prNumber: target.prNumber,
          }))
        const reviewable = filterReviewableDiff(
          rawDiff,
          reviewablePathPredicate(pathFilters)
        ).diff
        // Mask first, then cut: a cut through a credential would leave a
        // prefix too short for its pattern, and that prefix unmasked.
        const guardedDiff = guardInjectedText(reviewable)
        const cutDiff = cap(guardedDiff.text, PRE_MERGE_DIFF_MAX_CHARS)
        const materialOf = async (
          p: (typeof judged)[number],
          reqs: readonly LinkedRequirement[] | undefined
        ): Promise<string | null> => {
          const text = reqs
            ? requirementsMaterial(reqs)
            : p.gather
              ? await p.gather(gatherInput).catch(() => null)
              : null
          if (!text) return null
          const g = guardInjectedText(cap(text, PRE_MERGE_TEXT_MAX_CHARS).text)
          return [...g.notices, g.text].join('\n')
        }
        const { runPreMergeChecksModel } =
          await import('@/ee/security/llm/pre-merge-checks-client')
        const ask = async (
          checks: ReadonlyArray<{
            p: (typeof judged)[number]
            reqs: readonly LinkedRequirement[] | undefined
          }>
        ) => {
          const material = await Promise.all(
            checks.map(c => materialOf(c.p, c.reqs))
          )
          return runPreMergeChecksModel({
            checks: checks.map(({ p }, i) => ({
              id: p.id,
              name: p.name,
              rule: p.rule,
              material: material[i] ?? null,
            })),
            title: guardInjectedText(cap(pr.title, 500).text),
            // LUM-1151: the author's text — never Lumo's own summary section.
            body: guardInjectedText(
              cap(input.body, PRE_MERGE_TEXT_MAX_CHARS).text
            ),
            template: template
              ? guardInjectedText(cap(template, PRE_MERGE_TEXT_MAX_CHARS).text)
              : null,
            diff: { text: cutDiff.text, notices: guardedDiff.notices },
            // Cut to the budget, or an over-long line cut by the mask.
            diffTruncated: cutDiff.cut || guardedDiff.truncatedLines > 0,
            timeoutMs: PRE_MERGE_TIMEOUT_MS,
          })
        }
        const answer = await ask(
          judged.map(p => ({ p, reqs: linked.get(p.id) }))
        )
        let answers: readonly ChecksAnswer[] = answer.results
        // LUM-1149: a requirement the model gave no outcome for is asked
        // about once more, on its own, before it is reported as such. A
        // failed second ask keeps the first answer.
        const missing = unansweredRequirementsByCheck(judged, answers, linked)
        if (missing.size > 0) {
          try {
            const again = await ask(
              judged
                .filter(p => missing.has(p.id))
                .map(p => ({ p, reqs: missing.get(p.id) }))
            )
            answers = withRequirementAnswers(answers, again.results)
            logger.info(
              `[pre-merge-checks] asked again ${where} ${[...missing.entries()].map(([id, rs]) => `${id}=${rs.map(r => r.id).join(',')}`).join(' ')}`
            )
          } catch (error) {
            logger.info(
              `[pre-merge-checks] second ask failed ${where}: ${describe(error)}`
            )
          }
        }
        return resultsFromAnswers(judged, answers, linked)
      }
      let results: PreMergeCheckResult[]
      // Undecided by a failure (a read or the model): earlier failures stand.
      let undecided = unreadable.size > 0
      try {
        results = inOrder(judged.length > 0 ? await judge() : [])
      } catch (error) {
        logger.warn(
          `[pre-merge-checks] model unavailable ${where}: ${describe(error)}`
        )
        results = inOrder(
          inconclusiveResults(
            judged,
            'Lumo could not run this check this time.',
            linked
          )
        )
        undecided = true
      }
      if (undecided) {
        // Inconclusive — but an earlier failure of this head stands, so a
        // transient failure never unblocks approval. Unreadable ⇒ store
        // nothing (the row keeps whatever it had).
        let earlier: PreMergeChecksRecord | null
        try {
          earlier = checksForHead(
            await prSecurityScanRepository.findPreMergeChecks(target.scanId),
            target.headSha
          )
        } catch (readError) {
          logger.warn(
            `[pre-merge-checks] earlier results unreadable ${where}: ${describe(readError)} — left as stored`
          )
          return null
        }
        results = keepEarlierFailures(results, earlier)
      }
      record = { headSha: target.headSha, ranAt, results }
      await prSecurityScanRepository.setPreMergeChecks(target.scanId, record)
      logger.info(
        `[pre-merge-checks] ${where} ${results.map(r => `${r.id}=${r.verdict}`).join(' ')}`
      )
      return record
    } catch (error) {
      logger.warn(`[pre-merge-checks] not run ${where}: ${describe(error)}`)
      return record
    }
  },

  /**
   * The PR's title or description changed: re-run the checks on its newest
   * scan — only when that scan is of the PR's current head and its checks
   * already ran (a paused / unadmitted head gets no model call from an
   * edit) — then refresh the PR. Never throws.
   */
  async recheckAfterEdit(
    pullRequestId: string
  ): Promise<'rechecked' | 'skipped'> {
    try {
      const pr = await pullRequestRepository.findById(pullRequestId)
      if (!pr || pr.state !== 'open') return 'skipped'
      const scan =
        await prSecurityScanRepository.findLatestChecksTarget(pullRequestId)
      if (!scan || scan.preMergeChecks == null) return 'skipped'
      if (pr.headSha && scan.headSha !== pr.headSha) return 'skipped'
      await preMergeChecksService.run(
        {
          scanId: scan.id,
          pullRequestId,
          workspaceId: pr.workspaceId,
          repo: pr.repo,
          prNumber: pr.number,
          headSha: scan.headSha,
        },
        null
      )
      const { securityPrReviewService } =
        await import('@/ee/security/services/security-pr-review.service')
      await securityPrReviewService.sync(scan.id)
      return 'rechecked'
    } catch (error) {
      logger.warn(
        `[pre-merge-checks] recheck failed pr=${pullRequestId}: ${describe(error)}`
      )
      return 'skipped'
    }
  },
}
