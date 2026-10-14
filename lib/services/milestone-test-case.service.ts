import type { Prisma } from '@prisma/client'
import { runInTransaction } from '@/lib/db/transaction'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { projectService } from '@/lib/services/project.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import {
  milestoneCloseGateService,
  type MilestoneCloseGate,
} from '@/lib/services/milestone-close-gate.service'
import {
  testCaseRepository,
  type TestCaseRow,
  type TestCaseRunRow,
} from '@/lib/repositories/test-case.repository'
import {
  ceilingOf,
  executorResolver,
  fail,
  resolveRunFields,
  type TestCaseAttribution,
  type TestCaseRunWithExecutor,
} from '@/lib/services/test-case-core'
import { parseCaseRef } from '@/lib/test-cases/case-ref'
import type { RunCeiling } from '@/lib/test-cases/provability'
import type {
  CreateTestCaseBody,
  RecordRunBody,
  UpdateTestCaseBody,
} from '@/lib/validation/test-case'

export type MilestoneTestCaseWithRuns = TestCaseRow & {
  runs: TestCaseRunWithExecutor[]
}

async function authorize(milestoneId: string, memberId: string) {
  const milestone = await milestoneRepository.findById(milestoneId)
  if (!milestone) fail('Milestone not found', 404)
  // Membership check — throws 403/404 for a non-member.
  await projectService.getProject(milestone.projectId, memberId)
  return milestone
}

/** Same lock as the exit-criteria contract: a completed / archived milestone's cases are frozen. Runs stay allowed. */
function assertContractEditable(milestone: {
  archivedAt: Date | null
  completedAt: Date | null
}) {
  if (milestone.archivedAt)
    fail(
      'Milestone is archived; unarchive it before editing its test cases',
      409
    )
  if (milestone.completedAt !== null) {
    fail(
      'Milestone is completed — its test cases are locked. Reopen it (move a task back off DONE) to change them.',
      409
    )
  }
}

async function findCase(
  milestoneId: string,
  caseRef: string
): Promise<TestCaseRow> {
  const ref = parseCaseRef(decodeURIComponent(caseRef))
  const row =
    ref === null
      ? null
      : ref.kind === 'id'
        ? await testCaseRepository.findById(ref.id)
        : await testCaseRepository.findByMilestoneAndNumber(
            milestoneId,
            ref.number
          )
  // A cuid must belong to THIS milestone (not another milestone, not a task).
  if (!row || row.milestoneId !== milestoneId) fail('Test case not found', 404)
  return row
}

/**
 * LUM-1135: milestone-level test cases — cross-task end-to-end cases, and the
 * milestone close contract. Same append-only run log as task cases: there is
 * no updateRun / deleteRun. A milestone has no activity stream, so writes
 * record no TaskActivity rows; runs carry executor + session provenance.
 */
export const milestoneTestCaseService = {
  /** Public membership check (404 unknown milestone, 403/404 non-member) for routes that act on a run directly. */
  async authorize(milestoneId: string, memberId: string): Promise<void> {
    await authorize(milestoneId, memberId)
  },

  async resolveCase(
    milestoneId: string,
    caseRef: string,
    memberId: string
  ): Promise<TestCaseRow> {
    await authorize(milestoneId, memberId)
    return findCase(milestoneId, caseRef)
  },

  async list(
    milestoneId: string,
    memberId: string
  ): Promise<{
    testCases: MilestoneTestCaseWithRuns[]
    gate: MilestoneCloseGate
  }> {
    await authorize(milestoneId, memberId)
    const [cases, runs, gate] = await Promise.all([
      testCaseRepository.listForMilestone(milestoneId),
      testCaseRepository.runsPerCaseForMilestone(milestoneId),
      milestoneCloseGateService.read(milestoneId),
    ])
    const executedBy = await executorResolver([...runs.values()].flat())
    return {
      testCases: cases.map(c => ({
        ...c,
        runs: (runs.get(c.id) ?? []).map(r => ({
          ...r,
          executedBy: executedBy(r),
        })),
      })),
      gate,
    }
  },

  async getDetail(milestoneId: string, caseRef: string, memberId: string) {
    await authorize(milestoneId, memberId)
    const testCase = await findCase(milestoneId, caseRef)
    const runs = await testCaseRepository.listRuns(testCase.id)
    const executedBy = await executorResolver(runs)
    return {
      testCase,
      runs: runs.map(r => ({ ...r, executedBy: executedBy(r) })),
      // Same response shape as the task detail: a milestone run binds no PR
      // (commitSha only), so the list is always empty — but it is present.
      pullRequests: [],
    }
  },

  async create(
    milestoneId: string,
    body: CreateTestCaseBody,
    attribution: TestCaseAttribution
  ) {
    assertContractEditable(
      await authorize(milestoneId, attribution.actorMemberId)
    )
    const testCase = await runInTransaction(tx =>
      testCaseRepository.createWithNumber(
        {
          milestoneId,
          title: body.title,
          setup: body.setup ?? null,
          steps: body.steps,
          verification: body.verification,
          expected: body.expected,
          requiredEnvironment: body.requiredEnvironment ?? null,
        },
        tx
      )
    )
    // A new case that has never run holds the gate — a no-op while tasks are open,
    // but it must not be skipped once they are all DONE.
    milestoneRollupService.dispatchRollup(milestoneId)
    return { testCase }
  },

  async update(
    milestoneId: string,
    caseRef: string,
    body: UpdateTestCaseBody,
    attribution: TestCaseAttribution
  ) {
    assertContractEditable(
      await authorize(milestoneId, attribution.actorMemberId)
    )
    const existing = await findCase(milestoneId, caseRef)
    const testCase = await testCaseRepository.update(existing.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.setup !== undefined ? { setup: body.setup ?? null } : {}),
      ...(body.steps !== undefined ? { steps: body.steps } : {}),
      ...(body.verification !== undefined
        ? { verification: body.verification }
        : {}),
      ...(body.expected !== undefined ? { expected: body.expected } : {}),
      ...(body.requiredEnvironment !== undefined
        ? { requiredEnvironment: body.requiredEnvironment ?? null }
        : {}),
    })
    // requiredEnvironment shifts the provability ceiling, which can flip the gate.
    milestoneRollupService.dispatchRollup(milestoneId)
    return { testCase }
  },

  async remove(
    milestoneId: string,
    caseRef: string,
    attribution: TestCaseAttribution
  ): Promise<void> {
    assertContractEditable(
      await authorize(milestoneId, attribution.actorMemberId)
    )
    const existing = await findCase(milestoneId, caseRef)
    await testCaseRepository.softDelete(existing.id)
    // Removing the last held case can open the gate.
    milestoneRollupService.dispatchRollup(milestoneId)
  },

  async recordRun(
    milestoneId: string,
    caseRef: string,
    body: RecordRunBody,
    attribution: TestCaseAttribution
  ): Promise<{ run: TestCaseRunRow; ceiling: RunCeiling }> {
    await authorize(milestoneId, attribution.actorMemberId)
    const testCase = await findCase(milestoneId, caseRef)
    if (body.pullRequestNumber != null) {
      fail(
        'A milestone run does not bind a pull request — record commitSha instead.',
        400
      )
    }
    const fields = resolveRunFields(testCase, body)
    const run = await testCaseRepository.createRun({
      testCaseId: testCase.id,
      taskId: null,
      milestoneId,
      result: body.result,
      environment: body.environment,
      failedPhase: fields.failedPhase,
      failedIndex: fields.failedIndex,
      failedStepText: fields.failedStepText,
      failureAttribution: fields.failureAttribution,
      unprovenVerification:
        fields.unprovenVerification as unknown as Prisma.InputJsonValue,
      evidence: (body.evidence ?? []) as unknown as Prisma.InputJsonValue,
      stepResults: fields.stepResults as unknown as Prisma.InputJsonValue,
      actual: fields.actual,
      note: body.note ?? null,
      pullRequestId: null,
      commitSha: body.commitSha ?? null,
      // null 是「未知」，不是「干净」——不要 ?? false。
      commitDirty: body.commitDirty ?? null,
      executedByMemberId: attribution.actorMemberId,
      sourceSessionId: attribution.sourceSessionId,
    })
    milestoneRollupService.dispatchRollup(milestoneId)
    return {
      run,
      ceiling: ceilingOf(run, fields.unprovenVerification, testCase),
    }
  },
}
