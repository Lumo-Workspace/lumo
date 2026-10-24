/**
 * LUM-1149 — gathers the requirements the linked task / issue assessment
 * judges a PR against: the Goal and "Done when" items of the Lumo task the
 * PR is linked to (`PullRequest.taskId`), and the same-repository issues its
 * description closes or links (issue-assessment.ts has the parsing).
 *
 * Privacy: a task's requirements are marked quotable only on a PRIVATE
 * repository (visibility read live; unknown counts as public) or when the
 * workspace owner turned `taskDetailsOnPublicRepos` on. Visibility is read
 * only when there is a task to decide it for.
 *
 * Reads only — never changes the task. Throws when a read fails (the check
 * is then inconclusive, never not applicable); an empty list means nothing
 * is linked. The merged-PR context (LUM-1297) is optional: its lookup failing
 * only drops that context.
 *
 * LUM-1310 — two more optional pieces of context, each dropped when its read
 * fails: the task's test-case runs on the PR's head commit
 * (`test-case-evidence.ts`), and one bounded search of the head for the
 * requirements that claim something is absent across the repository
 * (`repo-absence-search.service.ts`; issues' requirements included).
 *
 * Layering: service — the database through repositories, GitHub through
 * `@/lib/integrations/github/contents` (loaded lazily).
 */
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskDecisionRepository } from '@/lib/repositories/task-decision.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { repoAbsenceSearchService } from '@/ee/security/services/repo-absence-search.service'
import { testCaseEvidenceAtHead } from '@/ee/security/security-scan/test-case-evidence'
import { absenceQueries } from '@/ee/security/security-scan/repo-absence-search'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import { logger } from '@/lib/logger'
import {
  extractTaskRequirements,
  extractTaskDecisions,
  TASK_REQUIREMENTS_MAX,
  type GatheredRequirements,
  type TaskAssessmentContext,
  issueRequirement,
  linkedIssueNumbers,
  type LinkedRequirement,
} from '@/ee/security/security-scan/issue-assessment'
import type { PreMergeCheckGatherInput } from '@/ee/security/security-scan/pre-merge-checks'

async function github() {
  return import('@/lib/integrations/github/contents')
}

/** LUM-1310: runs read per test case (newest first) to find one on the head. */
const EVIDENCE_RUNS_PER_CASE = 20

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const linkedRequirementsService = {
  async gather(input: PreMergeCheckGatherInput): Promise<GatheredRequirements> {
    const pr = await pullRequestRepository.findById(input.pullRequestId)
    const out: LinkedRequirement[] = []
    let context: TaskAssessmentContext | undefined
    if (pr?.taskId) {
      const task = await taskRepository.findForRequirements(
        pr.taskId,
        input.workspaceId
      )
      if (task) {
        const markdown = task.description
          ? htmlToMarkdown(task.description)
          : null
        const quotable =
          input.setting.issueAssessment.taskDetailsOnPublicRepos ||
          (await (
            await github()
          ).fetchRepoVisibility({
            workspaceId: input.workspaceId,
            fullName: input.repo,
          })) === 'private'
        // Optional context: a failed lookup drops it, never the whole check.
        const merged = (
          await pullRequestRepository
            .listMergedByTask(pr.taskId)
            .catch((error: unknown) => {
              logger.warn(
                `[linked-requirements] merged PRs unreadable task=${pr.taskId}; judging without them: ${error instanceof Error ? error.message : String(error)}`
              )
              return []
            })
        ).filter(
          p =>
            p.workspaceId === input.workspaceId &&
            !(
              p.repo.toLowerCase() === input.repo.toLowerCase() &&
              p.number === input.prNumber
            )
        )
        const recorded = await taskDecisionRepository
          .listByTask(pr.taskId, input.workspaceId)
          .catch((error: unknown) => {
            logger.warn(
              `[linked-requirements] decisions unreadable task=${pr.taskId}; judging without them: ${error instanceof Error ? error.message : String(error)}`
            )
            return []
          })
        context = {
          decisions: extractTaskDecisions(markdown, recorded),
          mergedPrCount: merged.length,
          mergedPrs: merged.slice(0, TASK_REQUIREMENTS_MAX).map(p => ({
            repo: p.repo,
            number: p.number,
            title: p.title,
          })),
        }
        out.push(
          ...extractTaskRequirements({
            identifier: `${task.team.identifier}-${task.number}`,
            title: task.title,
            markdown,
            quotable,
          })
        )
      }
    }
    const numbers = linkedIssueNumbers(input.pr.body, input.repo)
    if (numbers.length > 0) {
      const issues = await (
        await github()
      ).fetchRepoIssues({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        numbers,
      })
      for (const issue of issues) {
        const r = issueRequirement(issue)
        if (r) out.push(r)
      }
    }
    // LUM-1310: optional evidence — a failed read drops it, never the check.
    const taskId = context ? pr?.taskId : null
    const [testCases, repoSearch] = await Promise.all([
      taskId
        ? // Through a promise chain: even a synchronous throw is caught.
          Promise.resolve()
            .then(() =>
              testCaseRepository.listForEvidence(taskId, EVIDENCE_RUNS_PER_CASE)
            )
            .then(cases => testCaseEvidenceAtHead(cases, input.headSha))
            .catch((error: unknown) => {
              logger.warn(
                `[linked-requirements] test-case runs unreadable task=${taskId}; judging without them: ${describe(error)}`
              )
              return undefined
            })
        : undefined,
      Promise.resolve()
        .then(() =>
          repoAbsenceSearchService.search({
            workspaceId: input.workspaceId,
            repo: input.repo,
            headSha: input.headSha,
            queries: absenceQueries(out),
          })
        )
        .catch((error: unknown) => {
          logger.warn(
            `[linked-requirements] repository search failed repo=${input.repo}; judging without it: ${describe(error)}`
          )
          return undefined
        }),
    ])
    if (testCases || repoSearch)
      context = {
        ...(context ?? { decisions: [], mergedPrCount: 0, mergedPrs: [] }),
        ...(testCases ? { testCases } : {}),
        ...(repoSearch ? { repoSearch } : {}),
      }
    if (repoSearch)
      logger.info(
        `[linked-requirements] repository search repo=${input.repo} head=${input.headSha.slice(0, 7)} stop=${repoSearch.stop} files=${repoSearch.filesScanned} ${repoSearch.results.map(r => `${r.requirementId}=${r.hitCount}`).join(' ')}`
      )
    return { requirements: out, ...(context ? { context } : {}) }
  },
}
