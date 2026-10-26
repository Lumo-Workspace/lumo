/**
 * LUM-988 — run the agentic verifier over one scan's AI-review findings.
 *
 * Started by stage A after it persisted LLM_JUDGE rows (as a workflow).
 * LUM-1084: stage A starts it with `managedScanStarted: false`, so it boots
 * its own sealed VM at once (the hunt's attach-or-create, create path) rather
 * than wait up to 30 s + 90 s for the managed scan's hand-off — a race it
 * lost in every run the LUM-1084 production logs show. It then hands the
 * agent `runVerifierShell` and the diff of the cited files and — when the
 * verifier came back cleanly — hands what it left to the listwise ranker,
 * which may reject a policy-applicable finding it ranks below
 * RANKER_KEEP_THRESHOLD. Persists the verdicts the policy applies,
 * stamps `verifiedAt` and re-syncs the PR comments.
 *
 * Never throws, and always stamps `verifiedAt` and syncs: whatever goes wrong
 * (no VM, gateway down, timeout), the held findings are released and posted
 * unverified — the verifier may only ever remove false positives, never lose
 * a finding by failing.
 */
import { logger } from '@/lib/logger'
import {
  gitProviderFor,
  gitProviderRefOf,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { splitDiffByFile } from '@/ee/security/security-scan/diff-lines'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import {
  RANKER_DIFF_MAX_CHARS,
  RANKER_TIMEOUT_MS,
  VERIFIER_DIFF_MAX_CHARS,
  VERIFIER_MAX_STEPS,
  VERIFIER_TIMEOUT_MS,
  applyRankerPolicy,
  applyVerifierPolicy,
  rankerMayReject,
  verifierAppliesTo,
  verifierKindOf,
  type VerifierVerdict,
} from '@/ee/security/security-scan/verifier'
import {
  attachOrCreateHuntSandbox,
  releaseManagedScanVm,
  runVerifierShell,
  stopHuntSandbox,
  type HuntSandbox,
} from './security-hunt-sandbox'
import { securityPrReviewService } from './security-pr-review.service'
import { isReviewRankerEnabled } from './review-verifier.config'

export interface ReviewVerifierJob extends GitProviderRef {
  scanId: string
  workspaceId: string
  /** `owner/repo` */
  repo: string
  prNumber: number
  headSha: string
  /**
   * The managed scan was started with its VM kept alive for us to attach to.
   * LUM-1084: a verify job from stage A always passes false (boot our own VM
   * at once); a release-only job passes true.
   */
  managedScanStarted: boolean
  /**
   * Nobody else will use an attached VM (no hunt): stop it when done instead
   * of leaving it to idle out its 35-minute timeout. Only meaningful when
   * `managedScanStarted` is true (release-only jobs since LUM-1084).
   */
  stopAttachedWhenDone: boolean
  /**
   * LUM-988 — no verification: stage A kept the managed scan's VM alive
   * (since LUM-1084, for the hunt only) and the hunt did not start. Only stop
   * that VM, after its hand-off.
   */
  releaseOnly?: boolean
}

export interface ReviewVerifierOutcome {
  findings: number
  rejected: number
  /** Why no verdicts were recorded, else null. */
  error: string | null
}

/**
 * The diff sections of the cited files, smallest first, under `max` chars —
 * a large file's section is dropped rather than cut mid-hunk.
 */
export function citedDiff(
  diff: string,
  paths: ReadonlySet<string>,
  max: number
): string {
  const sections = splitDiffByFile(diff)
    .filter(s => s.path !== null && paths.has(s.path))
    .sort((a, b) => a.text.length - b.text.length)
  let out = ''
  for (const s of sections) {
    if (out.length + s.text.length + 1 > max) continue
    out += `${s.text}\n`
  }
  return out
}

type JudgeRow = Awaited<
  ReturnType<typeof prSecurityScanRepository.findJudgeFindingsForVerify>
>[number]

/**
 * LUM-988 — the listwise ranker over what the verifier left: every LLM_JUDGE
 * row it did not reject (HIGH and security rows too, as context), with the
 * verifier's reasons. Returns the extra rejections the policy applies. Never
 * throws: a failed or empty ranking adds nothing.
 */
async function rankAfterVerifier(input: {
  scanId: string
  judged: JudgeRow[]
  verdicts: ReadonlyArray<{ findingId: string; verdict: VerifierVerdict }>
  verifierReasons: ReadonlyMap<string, string>
  diff: string
}): Promise<
  Array<{ findingId: string; verdict: VerifierVerdict; reason: string }>
> {
  const rejected = new Set(
    input.verdicts.filter(v => v.verdict === 'REJECTED').map(v => v.findingId)
  )
  const left = input.judged.filter(f => !rejected.has(f.id))
  if (!left.some(rankerMayReject)) return []
  try {
    const { rankFindings } =
      await import('@/ee/security/llm/review-ranker-client')
    const out = await rankFindings({
      findings: left.map(f => ({
        id: f.id,
        kind: verifierKindOf(f.ruleId),
        severity: f.severity,
        filePath: f.filePath,
        line: f.line,
        title: f.title,
        detail: f.detail,
        evidence: f.evidence,
        verifierReason: input.verifierReasons.get(f.id) ?? '',
      })),
      diff: redactForInjection(
        citedDiff(
          input.diff,
          new Set(left.map(f => f.filePath)),
          RANKER_DIFF_MAX_CHARS
        )
      ).text,
      timeoutMs: RANKER_TIMEOUT_MS,
    })
    const added = applyRankerPolicy(left, out.ranking, rejected).map(v => ({
      ...v,
      reason: redactFindingProse(v.reason).slice(0, 400),
    }))
    logger.info(
      `[review-verifier] scan=${input.scanId} ranker findings=${left.length} ranked=${out.ranking.length} rejected=${added.length} in=${out.inputTokens} out=${out.outputTokens}${out.error ? ` error=${out.error.slice(0, 120)}` : ''}`
    )
    return added
  } catch (e) {
    logger.warn(
      `[review-verifier] scan=${input.scanId} ranker failed, keeping the verifier's verdicts: ${e instanceof Error ? e.message : String(e)}`
    )
    return []
  }
}

export const reviewVerifierService = {
  async run(job: ReviewVerifierJob): Promise<ReviewVerifierOutcome> {
    if (job.releaseOnly) {
      const released = await releaseManagedScanVm({ scanId: job.scanId })
      logger.info(
        `[review-verifier] scan=${job.scanId} release-only: ${released}`
      )
      return { findings: 0, rejected: 0, error: null }
    }
    let verdicts: Array<{
      findingId: string
      verdict: VerifierVerdict
      reason: string
    }> = []
    let findingsCount = 0
    let error: string | null = null
    let handle: HuntSandbox | null = null
    // Kept for the ranker, which runs after the VM is stopped.
    let diff = ''
    let judgedRows: JudgeRow[] = []
    let verifierReasons = new Map<string, string>()
    let verifierClean = false
    try {
      const judged = await prSecurityScanRepository.findJudgeFindingsForVerify(
        job.scanId
      )
      judgedRows = judged
      // LUM-988: only the rows the policy lets it reject — a HIGH or security
      // row costs steps and could never change.
      const findings = judged.filter(verifierAppliesTo)
      findingsCount = findings.length
      if (findings.length > 0) {
        diff = await gitProviderFor(job).fetchPrDiff({
          workspaceId: job.workspaceId,
          fullName: job.repo,
          prNumber: job.prNumber,
        })
        handle = await attachOrCreateHuntSandbox({
          ...gitProviderRefOf(job),
          scanId: job.scanId,
          workspaceId: job.workspaceId,
          repo: job.repo,
          headSha: job.headSha,
          managedScanStarted: job.managedScanStarted,
        })
        const vm = handle
        // Dynamic import keeps `ai` / the gateway out of the static graph.
        const { verifyFindings } =
          await import('@/ee/security/llm/review-verifier-client')
        const out = await verifyFindings({
          findings: findings.map(f => ({
            id: f.id,
            kind: verifierKindOf(f.ruleId),
            severity: f.severity,
            filePath: f.filePath,
            line: f.line,
            title: f.title,
            detail: f.detail,
            evidence: f.evidence,
          })),
          diff: redactForInjection(
            citedDiff(
              diff,
              new Set(findings.map(f => f.filePath)),
              VERIFIER_DIFF_MAX_CHARS
            )
          ).text,
          runShell: command => runVerifierShell(vm, command),
          maxSteps: VERIFIER_MAX_STEPS,
          timeoutMs: VERIFIER_TIMEOUT_MS,
        })
        error = out.error
        // The reason is model text headed for the panel and the CLI.
        verdicts = applyVerifierPolicy(findings, out.results).map(v => ({
          ...v,
          reason: redactFindingProse(v.reason).slice(0, 400),
        }))
        verifierClean = out.error === null
        verifierReasons = new Map(
          out.results
            .filter(r => !r.defaulted)
            .map(r => [r.id, redactFindingProse(r.reason).slice(0, 400)])
        )
        logger.info(
          `[review-verifier] scan=${job.scanId} findings=${findings.length} applied=${verdicts.length} rejected=${verdicts.filter(v => v.verdict === 'REJECTED').length} defaulted=${out.results.filter(r => r.defaulted).length}${out.wrapUp ? ` wrapUp=${out.wrapUp.attempts}/${out.wrapUp.submitted ? 'submitted' : 'none'}` : ''} steps=${out.steps} commands=${out.commands} in=${out.inputTokens} cacheRead=${out.cacheReadTokens} cacheWrite=${out.cacheWriteTokens} out=${out.outputTokens}${out.error ? ` error=${out.error.slice(0, 120)}` : ''}`
        )
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      logger.warn(
        `[review-verifier] scan=${job.scanId} failed, posting unverified: ${error}`
      )
    } finally {
      if (handle)
        await stopHuntSandbox(handle, {
          includeAttached: job.stopAttachedWhenDone,
        })
    }
    if (verifierClean && isReviewRankerEnabled()) {
      // A ranker rejection replaces the verifier's CONFIRMED for that row.
      const ranked = await rankAfterVerifier({
        scanId: job.scanId,
        judged: judgedRows,
        verdicts,
        verifierReasons,
        diff,
      })
      const byId = new Map(ranked.map(v => [v.findingId, v]))
      verdicts = [
        ...verdicts.map(v => byId.get(v.findingId) ?? v),
        ...ranked.filter(r => !verdicts.some(v => v.findingId === r.findingId)),
      ]
    }
    try {
      await prSecurityScanRepository.completeVerification(job.scanId, verdicts)
    } catch (e) {
      logger.warn(
        `[review-verifier] scan=${job.scanId} could not record verdicts: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    await securityPrReviewService.sync(job.scanId)
    return {
      findings: findingsCount,
      rejected: verdicts.filter(v => v.verdict === 'REJECTED').length,
      error,
    }
  },
}
