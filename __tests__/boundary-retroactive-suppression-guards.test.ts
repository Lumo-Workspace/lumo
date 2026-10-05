/**
 * @jest-environment node
 *
 * LUM-759 — the blast radius of a retroactive suppression sweep.
 *
 * `retroactiveSuppressionWhere` IS the blast radius: the preview a human reads
 * and the sweep that stamps rows both go through it, so what it selects is the
 * whole of what a single click can rewrite. It is proven here by EVALUATING it
 * against a table of rows rather than by matching its object shape — a shape
 * assertion would have happily accepted `NOT: { id, detail }`, which negates
 * the conjunction and would have let evasion-decoded rows through.
 *
 * The evaluator below implements only the handful of operators the predicate
 * uses, with Prisma's semantics: fields inside one filter object are ANDed,
 * `NOT` as a list requires every clause to fail, `OR` requires one to hold.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { RETROACTIVE_SUPPRESSION_CAP } from '@/lib/boundary-crossing/suppression'
import { EVASION_MARKER } from '@/lib/boundary-crossing/evasion'

type TxCallback = (client: unknown) => unknown

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

// --- a faithful mini-evaluator for the operators the predicate uses ----------
interface Row {
  id: string
  projectId: string | null
  milestoneProjectId: string | null
  category: string
  target: string | null
  detail: string
  disposition: string | null
}

type Filter = Record<string, unknown>

function matchesField(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object') {
    const c = cond as { startsWith?: string; contains?: string }
    if (c.startsWith !== undefined)
      return typeof value === 'string' && value.startsWith(c.startsWith)
    if (c.contains !== undefined)
      return typeof value === 'string' && value.includes(c.contains)
    throw new Error(`unsupported operator: ${JSON.stringify(cond)}`)
  }
  return value === cond
}

/** Prisma semantics: keys inside one object are ANDed. */
function matches(row: Row, where: Filter): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'NOT') {
      // A list NOT holds only when EVERY clause fails to match.
      const clauses = (Array.isArray(cond) ? cond : [cond]) as Filter[]
      return clauses.every(clause => !matches(row, clause))
    }
    if (key === 'OR') {
      return (cond as Filter[]).some(clause => matches(row, clause))
    }
    if (key === 'task') {
      return (
        row.projectId != null &&
        matches(row, { projectId: (cond as Filter).projectId })
      )
    }
    if (key === 'milestone') {
      return (
        row.milestoneProjectId != null &&
        row.milestoneProjectId === (cond as Filter).projectId
      )
    }
    return matchesField((row as unknown as Record<string, unknown>)[key], cond)
  })
}

const base: Omit<Row, 'id'> = {
  projectId: 'p-1',
  milestoneProjectId: null,
  category: 'PROJECT_RULE_VIOLATION',
  target: 'actionrule:a8c320ce',
  detail: 'gh pr create --base main',
  disposition: null,
}
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  ...base,
  ...over,
})

const sweepWhere = (
  over: Partial<
    Parameters<typeof boundaryCrossingRepository.retroactiveSuppressionWhere>[0]
  > = {}
) =>
  boundaryCrossingRepository.retroactiveSuppressionWhere({
    projectId: 'p-1',
    category: 'PROJECT_RULE_VIOLATION',
    targetPattern: 'actionrule:a8c320ce',
    ...over,
  }) as Filter

/** LUM-907: the audit context is required on every ruling. */
const TEST_AUDIT = {
  workspaceId: 'ws-1',
  context: {
    actor: { type: 'MEMBER' as const, memberId: 'member-1' },
    source: 'WEB' as const,
  },
}

describe('LUM-759 — the sweep never reaches past its blast radius', () => {
  it('an already-dispositioned crossing — human, AUTO_LEGIT or an earlier AUTO_SUPPRESSED — is never rewritten by a later rule', () => {
    const where = sweepWhere()
    expect(matches(row('open'), where)).toBe(true)
    for (const d of [
      'FALSE_POSITIVE',
      'CONFIRMED',
      'AUTO_LEGIT',
      'AUTO_SUPPRESSED',
    ]) {
      expect(matches(row(`d-${d}`, { disposition: d }), where)).toBe(false)
    }
  })

  it('an evasion-decoded crossing is never swept, even alongside a source-crossing exclusion', () => {
    // Both NOT clauses must hold independently: the regression guard for
    // `NOT: { id, detail }`, which would negate only the conjunction.
    const where = sweepWhere({ excludeCrossingId: 'bc-source' })
    expect(
      matches(row('bc-evasive', { detail: `${EVASION_MARKER}rm -rf /` }), where)
    ).toBe(false)
    expect(matches(row('bc-source'), where)).toBe(false)
    expect(matches(row('bc-other'), where)).toBe(true)
  })

  it('a crossing in another project, and one with no coalescing target, are outside the sweep', () => {
    const where = sweepWhere()
    expect(matches(row('elsewhere', { projectId: 'p-other' }), where)).toBe(
      false
    )
    expect(matches(row('legacy', { target: null }), where)).toBe(false)
    // LUM-640 steward crossings hang off a milestone; same project, so in.
    expect(
      matches(
        row('steward', { projectId: null, milestoneProjectId: 'p-1' }),
        where
      )
    ).toBe(true)
    expect(
      matches(
        row('steward-elsewhere', {
          projectId: null,
          milestoneProjectId: 'p-other',
        }),
        where
      )
    ).toBe(false)
  })

  it('a different category is out, and a prefix pattern matches by prefix only', () => {
    const exact = sweepWhere()
    expect(
      matches(row('other-cat', { category: 'TEST_TAMPERING' }), exact)
    ).toBe(false)
    expect(
      matches(row('near', { target: 'actionrule:a8c320cef' }), exact)
    ).toBe(false)

    const prefix = sweepWhere({ targetPattern: 'actionrule:*' })
    expect(matches(row('a', { target: 'actionrule:zzz' }), prefix)).toBe(true)
    expect(matches(row('b', { target: 'npm:left-pad' }), prefix)).toBe(false)
  })

  it('a non-suppressible HIGH-class crossing is refused before any rule or sweep exists', async () => {
    const findById = jest.spyOn(boundaryCrossingRepository, 'findById')
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'HARDCODED_SECRET',
      target: 'lib/secret.ts',
      disposition: null,
    } as never)
    const sweepSpy = jest.spyOn(
      crossingSuppressionRuleRepository,
      'createWithRetroactiveSweep'
    )
    const dispositionSpy = jest
      .spyOn(boundaryCrossingRepository, 'disposition')
      .mockResolvedValue({ count: 1 } as never)

    await expect(
      boundaryCrossingService.disposition(
        't-1',
        'bc-1',
        'FALSE_POSITIVE',
        null,
        {
          actorMemberId: 'member-1',
          actorClerkId: 'clerk-1',
          audit: TEST_AUDIT,
        },
        { suppressSimilarInProject: true }
      )
    ).rejects.toMatchObject({ status: 422 })
    expect(sweepSpy).not.toHaveBeenCalled()
    expect(dispositionSpy).not.toHaveBeenCalled()
    findById.mockRestore()
    sweepSpy.mockRestore()
    dispositionSpy.mockRestore()
  })

  it('one creation is capped: only the most recent cap rows are stamped and the outcome says it was capped', async () => {
    const overCap = RETROACTIVE_SUPPRESSION_CAP + 7
    // The repository asks for cap + 1 and reports `capped` off the overflow row.
    const candidates = Array.from({
      length: RETROACTIVE_SUPPRESSION_CAP + 1,
    }).map((_, i) => ({
      id: `bc-${i}`,
      taskId: 't-1',
      category: 'PROJECT_RULE_VIOLATION' as const,
      detail: 'gh pr create --base main',
    }))
    const findCandidates = jest
      .spyOn(boundaryCrossingRepository, 'findRetroactiveSuppressionCandidates')
      .mockResolvedValue(candidates)
    const suppressMany = jest
      .spyOn(boundaryCrossingRepository, 'suppressManyByIds')
      .mockImplementation(async ids => ids.length)

    const txPrisma = jest.requireMock('@/lib/db/prisma') as {
      prisma: Record<string, unknown>
    }
    txPrisma.prisma.$transaction = async (fn: TxCallback) =>
      fn({
        crossingSuppressionRule: {
          create: async () => ({
            id: 'rule-1',
            reason: null,
            category: 'PROJECT_RULE_VIOLATION',
            targetPattern: 'actionrule:a8c320ce',
          }),
        },
      })

    const outcome =
      await crossingSuppressionRuleRepository.createWithRetroactiveSweep(
        {
          projectId: 'p-1',
          category: 'PROJECT_RULE_VIOLATION',
          targetPattern: 'actionrule:a8c320ce',
          reason: null,
          createdById: 'member-1',
          sourceCrossingId: 'bc-source',
        },
        {
          limit: RETROACTIVE_SUPPRESSION_CAP,
          actorId: 'actor-1',
          now: new Date(),
        }
      )

    expect(findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ limit: RETROACTIVE_SUPPRESSION_CAP + 1 }),
      expect.anything()
    )
    expect(outcome.capped).toBe(true)
    expect(outcome.suppressedCount).toBe(RETROACTIVE_SUPPRESSION_CAP)
    expect(suppressMany.mock.calls[0]![0]).toHaveLength(
      RETROACTIVE_SUPPRESSION_CAP
    )
    expect(overCap).toBeGreaterThan(RETROACTIVE_SUPPRESSION_CAP)
    findCandidates.mockRestore()
    suppressMany.mockRestore()
  })
})

/** The cap exists so one click can never rewrite an unbounded audit slice. */
it('the per-creation cap is a real bound, not an unlimited sweep', () => {
  expect(RETROACTIVE_SUPPRESSION_CAP).toBe(500)
})

// The service test above needs the task lookup to resolve a project.
;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
  id: 't-1',
  projectId: 'p-1',
})
