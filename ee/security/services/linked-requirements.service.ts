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
 * is linked.
 *
 * Layering: service — the database through repositories, GitHub through
 * `@/lib/integrations/github/contents` (loaded lazily).
 */
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
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
        const merged = (
          await pullRequestRepository.listMergedByTask(pr.taskId)
        ).filter(
          p =>
            p.workspaceId === input.workspaceId &&
            !(
              p.repo.toLowerCase() === input.repo.toLowerCase() &&
              p.number === input.prNumber
            )
        )
        context = {
          decisions: extractTaskDecisions(markdown),
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
    return { requirements: out, ...(context ? { context } : {}) }
  },
}
