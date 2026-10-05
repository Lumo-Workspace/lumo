/**
 * LUM-988 — run the agentic verifier over one scan's AI-review findings.
 *
 * Started by stage A after it persisted LLM_JUDGE rows (as a workflow, so it
 * may wait for the managed scan's VM). Attaches to that VM — kept alive while
 * the AI review is on — or boots its own sealed one (the hunt's
 * attach-or-create), hands the agent `runVerifierShell` and the diff of the
 * cited files, persists the verdicts the policy applies, stamps `verifiedAt`
 * and re-syncs the PR comments.
 *
 * Never throws, and always stamps `verifiedAt` and syncs: whatever goes wrong
 * (no VM, gateway down, timeout), the held findings are released and posted
 * unverified — the verifier may only ever remove false positives, never lose
 * a finding by failing.
 */
import { logger } from '@/lib/logger'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { splitDiffByFile } from '@/lib/security-scan/diff-lines'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'
import { redactKnownSecrets } from '@/lib/security-scan'
import {
  VERIFIER_DIFF_MAX_CHARS,
  VERIFIER_MAX_STEPS,
  VERIFIER_TIMEOUT_MS,
  applyVerifierPolicy,
  verifierKindOf,
  type VerifierVerdict,
} from '@/lib/security-scan/verifier'
import {
  attachOrCreateHuntSandbox,
  runVerifierShell,
  stopHuntSandbox,
  type HuntSandbox,
} from './security-hunt-sandbox'
import { securityPrReviewService } from './security-pr-review.service'

export interface ReviewVerifierJob {
  scanId: string
  workspaceId: string
  /** `owner/repo` */
  repo: string
  prNumber: number
  headSha: string
  /** The managed scan was started with its VM kept alive for us to attach to. */
  managedScanStarted: boolean
  /**
   * Nobody else will use an attached VM (no hunt): stop it when done instead
   * of leaving it to idle out its 35-minute timeout.
   */
  stopAttachedWhenDone: boolean
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

export const reviewVerifierService = {
  async run(job: ReviewVerifierJob): Promise<ReviewVerifierOutcome> {
    let verdicts: Array<{
      findingId: string
      verdict: VerifierVerdict
      reason: string
    }> = []
    let findingsCount = 0
    let error: string | null = null
    let handle: HuntSandbox | null = null
    try {
      const findings =
        await prSecurityScanRepository.findJudgeFindingsForVerify(job.scanId)
      findingsCount = findings.length
      if (findings.length > 0) {
        const diff = await fetchPrDiff({
          workspaceId: job.workspaceId,
          fullName: job.repo,
          prNumber: job.prNumber,
        })
        handle = await attachOrCreateHuntSandbox({
          scanId: job.scanId,
          workspaceId: job.workspaceId,
          repo: job.repo,
          headSha: job.headSha,
          managedScanStarted: job.managedScanStarted,
        })
        const vm = handle
        // Dynamic import keeps `ai` / the gateway out of the static graph.
        const { verifyFindings } =
          await import('@/lib/llm/review-verifier-client')
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
          reason: redactKnownSecrets(v.reason).slice(0, 400),
        }))
        logger.info(
          `[review-verifier] scan=${job.scanId} findings=${findings.length} applied=${verdicts.length} rejected=${verdicts.filter(v => v.verdict === 'REJECTED').length} steps=${out.steps} commands=${out.commands} in=${out.inputTokens} out=${out.outputTokens}${out.error ? ` error=${out.error.slice(0, 120)}` : ''}`
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
