/**
 * LUM-1155 — `@<app> diagram`: draw the sequence diagram of the PR's main
 * call flow again, on request, into the walkthrough of Lumo's summary
 * comment.
 *
 *  - the setting as it is NOW (`.lumo.yaml` on the base commit > stored >
 *    default): off → refused, nothing drawn;
 *  - only for the PR's newest review, and only when that review is of the
 *    PR's current head (otherwise the review of the newest push brings its
 *    own diagram);
 *  - a trivial PR (`sequenceDiagramEligible`) gets no model call;
 *  - the whole reviewable PR diff (path filters applied) is secret-masked
 *    and guarded (`guardInjectedText`) BEFORE it is cut, then one
 *    diagram-only call on the summary tier; the answer is validated
 *    (`cleanSequenceDiagram`) and stored on the scan, and the summary
 *    comment is refreshed from it.
 *
 * Never throws: every failure is a reply. Layering: service — the model
 * behind a dynamic import, GitHub through `@/lib/integrations/github`, the
 * database through the repository.
 */
import { logger } from '@/lib/logger'
import { guardInjectedText } from '@/lib/security-scan/inject-guard'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  filterReviewableDiff,
  reviewablePathPredicate,
} from '@/ee/security/security-scan/reviewable-path'
import {
  cleanSequenceDiagram,
  sequenceDiagramEligible,
} from '@/ee/security/security-scan/sequence-diagram'
import {
  diffFileStats,
  WHOLE_PR_SUMMARY_DIFF_MAX_CHARS,
  WHOLE_PR_SUMMARY_MAX_FILES,
  WHOLE_PR_SUMMARY_TIMEOUT_MS,
} from './pr-whole-summary.service'
import { repoConfigService } from './repo-config.service'

/** What `@<app> diagram` found to do (the reply is worded from it). */
export type DiagramCommandResult =
  | { kind: 'off' }
  | { kind: 'no_review' }
  | { kind: 'stale'; sha: string }
  | { kind: 'trivial'; sha: string }
  | { kind: 'none'; sha: string }
  | { kind: 'failed' }
  | { kind: 'drawn'; sha: string; posted: boolean }

async function github() {
  return import('@/lib/integrations/github/contents')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const prSequenceDiagramService = {
  async regenerate(input: {
    workspaceId: string
    pullRequestId: string
    /** `owner/name`. */
    repo: string
    prNumber: number
  }): Promise<DiagramCommandResult> {
    const where = `pr=${input.repo}#${input.prNumber}`
    try {
      const scan = await prSecurityScanRepository.findLatestForDiagram(
        input.pullRequestId
      )
      if (!scan) return { kind: 'no_review' }
      const settings =
        await repoConfigService.sequenceDiagramSettingsForPullRequest({
          workspaceId: input.workspaceId,
          repo: input.repo,
          prNumber: input.prNumber,
        })
      if (!settings.enabled) return { kind: 'off' }
      const gh = await github()
      const target = {
        workspaceId: input.workspaceId,
        fullName: input.repo,
        prNumber: input.prNumber,
      }
      const head = await gh.fetchPrHeadSha(target)
      if (head !== scan.headSha) return { kind: 'stale', sha: scan.headSha }
      const raw = await gh.fetchPrDiff(target)
      const reviewable = filterReviewableDiff(
        raw,
        reviewablePathPredicate(settings.pathFilters)
      ).diff
      const files = diffFileStats(reviewable)
      if (!sequenceDiagramEligible(files))
        return { kind: 'trivial', sha: scan.headSha }
      // Mask first, then cut: a cut through a credential would leave a
      // prefix too short for its pattern, and that prefix unmasked.
      const guarded = guardInjectedText(reviewable)
      const cut = guarded.text.length > WHOLE_PR_SUMMARY_DIFF_MAX_CHARS
      const { drawSequenceDiagram } =
        await import('@/ee/security/llm/sequence-diagram-client')
      const answer = await drawSequenceDiagram({
        diff: {
          text: cut
            ? guarded.text.slice(0, WHOLE_PR_SUMMARY_DIFF_MAX_CHARS)
            : guarded.text,
          notices: guarded.notices,
        },
        diffTruncated: cut || guarded.truncatedLines > 0,
        files: files.slice(0, WHOLE_PR_SUMMARY_MAX_FILES),
        moreFiles: Math.max(0, files.length - WHOLE_PR_SUMMARY_MAX_FILES),
        timeoutMs: WHOLE_PR_SUMMARY_TIMEOUT_MS,
      })
      // Model text headed for a public PR: validated, redacted, bounded.
      const diagram = cleanSequenceDiagram(answer)
      logger.info(
        `[pr-sequence-diagram] drawn on request ${where} files=${files.length} diffChars=${guarded.text.length} ${diagram ? 'diagram' : 'none'}`
      )
      if (!diagram) return { kind: 'none', sha: scan.headSha }
      await prSecurityScanRepository.setSequenceDiagram(scan.id, diagram)
      // Loaded lazily: the write-back is heavy and only this path needs it.
      const { securityPrReviewService } =
        await import('@/ee/security/services/security-pr-review.service')
      const synced = await securityPrReviewService.sync(scan.id)
      return { kind: 'drawn', sha: scan.headSha, posted: synced.posted }
    } catch (error) {
      logger.warn(
        `[pr-sequence-diagram] not drawn ${where}: ${describe(error)}`
      )
      return { kind: 'failed' }
    }
  },
}

/** PURE — the reply to `@<app> diagram`. */
export function buildDiagramCommandReply(
  r: DiagramCommandResult,
  handle: string
): string {
  switch (r.kind) {
    case 'off':
      return 'ℹ️ Sequence diagrams are turned off for this repository. A workspace owner can turn them on in the repository’s review settings (or `reviews.sequence_diagrams` in `.lumo.yaml`).'
    case 'no_review':
      return `⏳ Lumo has not reviewed this PR yet — the diagram comes with the first review (or comment \`${handle} review\`).`
    case 'stale':
      return `⏳ Lumo’s latest review (\`${r.sha.slice(0, 7)}\`) is not of the PR’s newest commit — the review of that push draws its own diagram. Comment \`${handle} review\` if it has not started.`
    case 'trivial':
      return `ℹ️ This PR is too small for a sequence diagram (fewer than two changed source files, or only a few changed lines) — nothing to draw for \`${r.sha.slice(0, 7)}\`.`
    case 'none':
      return `ℹ️ Lumo found no call flow across two or more components to draw for \`${r.sha.slice(0, 7)}\` — the summary comment is unchanged.`
    case 'failed':
      return `⚠️ Lumo couldn’t draw the diagram this time — try \`${handle} diagram\` again later.`
    case 'drawn':
      return r.posted
        ? `✅ Drew the sequence diagram of this PR’s call flow — it is in the walkthrough of Lumo’s summary comment (review of \`${r.sha.slice(0, 7)}\`).`
        : `✅ Drew the sequence diagram (review of \`${r.sha.slice(0, 7)}\`); it appears in Lumo’s summary comment on its next update.`
  }
}
