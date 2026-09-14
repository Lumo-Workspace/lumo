/**
 * @jest-environment node
 *
 * LUM-759 — revoking a rule is the symmetric inverse of creating it.
 *
 * If revoking only stopped FUTURE suppression, the two directions would not
 * mean the same thing: a rule could be taken back while everything it had
 * silenced stayed silent. So a revoke puts every crossing still carrying that
 * rule's stamp back to a CLEAN open row, in the same transaction as the soft
 * revoke, appending the reverse transition per crossing. A crossing a human
 * has re-dispositioned since no longer carries the stamp, so their ruling wins.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { crossingSuppressionRuleRepository } from '@/lib/repositories/crossing-suppression-rule.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { RULE_REVOKED_REASON } from '@/lib/boundary-crossing/suppression'

interface Row {
  id: string
  taskId: string | null
  category: string
  detail: string
  disposition: string | null
  dispositionNote: string | null
  dispositionedAt: Date | null
  dispositionedById: string | null
  suppressionRuleId: string | null
}
let store: Row[] = []
let txWrites: string[] = []
let ruleRow: { revokedAt: Date | null; revokedById: string | null } = {
  revokedAt: null,
  revokedById: null,
}

type TxCallback = (client: unknown) => unknown

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (fn: TxCallback) => {
      txWrites = []
      return fn({
        crossingSuppressionRule: {
          update: async ({ data }: { data: Record<string, unknown> }) => {
            txWrites.push('revoke')
            ruleRow = {
              revokedAt: data.revokedAt as Date,
              revokedById: (data.revokedById as string | null) ?? null,
            }
            return { id: 'rule-1' }
          },
        },
      })
    }),
  },
}))

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findSuppressedByRule: jest.fn(async (ruleId: string) =>
      store
        .filter(
          r =>
            r.suppressionRuleId === ruleId &&
            r.disposition === 'AUTO_SUPPRESSED'
        )
        .map(r => ({
          id: r.id,
          taskId: r.taskId,
          category: r.category,
          detail: r.detail,
        }))
    ),
    reopenManyByIds: jest.fn(async (ids: string[]) => {
      txWrites.push(`reopen:${ids.length}`)
      let n = 0
      for (const r of store) {
        if (!ids.includes(r.id)) continue
        r.disposition = null
        r.dispositionNote = null
        r.dispositionedAt = null
        r.dispositionedById = null
        r.suppressionRuleId = null
        n++
      }
      return n
    }),
    findById: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(async () => {
      txWrites.push('activity')
      return { id: 'act' }
    }),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))

const createActivity = activityRepository.create as jest.Mock
const findWithProject = taskRepository.findWithProject as jest.Mock
// The rule repository itself is REAL here (its transaction is what we prove);
// only its prisma read for the ownership guard is stubbed.
const ruleFindById = jest.spyOn(crossingSuppressionRuleRepository, 'findById')

const suppressed = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  taskId: 't-1',
  category: 'PROJECT_RULE_VIOLATION',
  detail: 'gh pr create --base main',
  disposition: 'AUTO_SUPPRESSED',
  dispositionNote: 'Auto-dispositioned by repository suppression rule rule-1',
  dispositionedAt: new Date('2026-09-11T00:00:00Z'),
  dispositionedById: null,
  suppressionRuleId: 'rule-1',
  ...over,
})

const ATTRIBUTION = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

beforeEach(() => {
  jest.clearAllMocks()
  store = []
  txWrites = []
  ruleRow = { revokedAt: null, revokedById: null }
  findWithProject.mockResolvedValue({ id: 't-1', projectId: 'p-1' })
  ruleFindById.mockResolvedValue({
    id: 'rule-1',
    projectId: 'p-1',
    revokedAt: null,
  })
  createActivity.mockImplementation(async () => {
    txWrites.push('activity')
    return { id: 'act' }
  })
})

describe('LUM-759 — revoking a rule puts back what it suppressed', () => {
  it('every crossing carrying the rule stamp returns to a clean open row', async () => {
    store.push(suppressed('bc-1'), suppressed('bc-2', { taskId: 't-2' }))

    const out = await boundaryCrossingService.revokeSuppressionRule(
      't-1',
      'rule-1',
      ATTRIBUTION
    )

    expect(out.reopenedCount).toBe(2)
    for (const r of store) {
      expect(r.disposition).toBeNull()
      expect(r.dispositionNote).toBeNull()
      expect(r.dispositionedAt).toBeNull()
      expect(r.dispositionedById).toBeNull()
      // The rule ref goes too: a dangling ref would strand the row between the
      // open-coalescing key (disposition null) and the suppressed one (ruleId).
      expect(r.suppressionRuleId).toBeNull()
    }
  })

  it('the soft revoke and the restorations commit in one transaction', async () => {
    store.push(suppressed('bc-1'), suppressed('bc-2', { taskId: 't-2' }))
    await boundaryCrossingService.revokeSuppressionRule(
      't-1',
      'rule-1',
      ATTRIBUTION
    )
    expect(txWrites).toEqual(['revoke', 'reopen:2', 'activity', 'activity'])
    // Soft, never a delete — the rule row stays for audit.
    expect(ruleRow.revokedAt).toBeInstanceOf(Date)
    expect(ruleRow.revokedById).toBe('member-1')
    expect(crossingSuppressionRuleRepository).not.toHaveProperty('delete')
  })

  it('each restoration appends its own activity with the reverse transition and a rule-revoked reason', async () => {
    store.push(suppressed('bc-1'))
    await boundaryCrossingService.revokeSuppressionRule(
      't-1',
      'rule-1',
      ATTRIBUTION
    )
    const payload = createActivity.mock.calls[0]![0] as {
      type: string
      payload: Record<string, unknown>
    }
    expect(payload.type).toBe('BOUNDARY_CROSSING_DISPOSITIONED')
    expect(payload.payload.from).toBe('AUTO_SUPPRESSED')
    expect(payload.payload.to).toBeNull()
    expect(payload.payload.reason).toBe(RULE_REVOKED_REASON)
    expect(payload.payload.suppressionRuleId).toBe('rule-1')
  })

  it('a crossing a human re-dispositioned after the rule is left exactly as the human ruled', async () => {
    store.push(
      suppressed('bc-1'),
      suppressed('bc-human', {
        disposition: 'CONFIRMED',
        dispositionedById: 'actor-9',
        dispositionNote: 'real crossing',
      })
    )

    const out = await boundaryCrossingService.revokeSuppressionRule(
      't-1',
      'rule-1',
      ATTRIBUTION
    )

    expect(out.reopenedCount).toBe(1)
    const human = store.find(r => r.id === 'bc-human')!
    expect(human.disposition).toBe('CONFIRMED')
    expect(human.dispositionedById).toBe('actor-9')
    expect(human.dispositionNote).toBe('real crossing')
  })

  it('re-revoking an already-revoked rule reopens nothing and stays idempotent', async () => {
    ruleFindById.mockResolvedValue({
      id: 'rule-1',
      projectId: 'p-1',
      revokedAt: new Date('2026-09-01T00:00:00Z'),
    })
    store.push(suppressed('bc-1'))

    const out = await boundaryCrossingService.revokeSuppressionRule(
      't-1',
      'rule-1',
      ATTRIBUTION
    )

    expect(out.reopenedCount).toBe(0)
    expect(out.revokedAt).toBe(new Date('2026-09-01T00:00:00Z').toISOString())
    expect(boundaryCrossingRepository.reopenManyByIds).not.toHaveBeenCalled()
    expect(store[0]!.disposition).toBe('AUTO_SUPPRESSED')
  })

  it('a rule belonging to another project reopens nothing and is 404', async () => {
    ruleFindById.mockResolvedValue({
      id: 'rule-9',
      projectId: 'p-other',
      revokedAt: null,
    })
    store.push(suppressed('bc-1'))

    await expect(
      boundaryCrossingService.revokeSuppressionRule(
        't-1',
        'rule-9',
        ATTRIBUTION
      )
    ).rejects.toMatchObject({ status: 404 })
    expect(boundaryCrossingRepository.reopenManyByIds).not.toHaveBeenCalled()
    expect(store[0]!.disposition).toBe('AUTO_SUPPRESSED')
  })
})
