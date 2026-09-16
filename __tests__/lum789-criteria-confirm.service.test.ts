/**
 * LUM-789: 合同确认写路径。这些用例驱动真实的 service 与真实的
 * acceptanceCriterionRepository，只在最底层 mock `@/lib/db/prisma`
 * ——所以幂等 no-op（重复确认不改写原时间戳）和「无合同抛 400」
 * 这类断言测的是真实的 where 子句，不是桩出来的假象。
 * 与 acceptanceCriterionRepository 协作但不在测试范围内的仓库
 * （verificationRunRepository / activityRepository / memberRepository）
 * 以及审计评论副作用（comment.service / actor / waitUntil）照常 mock 掉。
 */

interface FakeRow {
  id: string
  taskId: string
  statement: string
  verifierType: string
  checkpointer: string | null
  evidenceRequired: boolean
  judgeSteps: string | null
  source: string
  addedAtRound: number
  referentKind: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  confirmedAt: Date | null
  confirmedByMemberId: string | null
}

let rows: FakeRow[] = []
let nextId = 1

function reset(): void {
  rows = []
  nextId = 1
}

function seed(taskId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `c-${nextId++}`,
      taskId,
      statement: `criterion ${i}`,
      verifierType: 'MACHINE',
      checkpointer: 'npx jest',
      evidenceRequired: false,
      judgeSteps: null,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      referentKind: 'AGENT_CONSTRUCTED_STATE',
      createdAt: new Date('2026-06-01'),
      updatedAt: new Date('2026-06-01'),
      deletedAt: null,
      confirmedAt: null,
      confirmedByMemberId: null,
    })
  }
}

jest.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {
    acceptanceCriterion: {
      findMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {}
        return rows.filter(r => {
          if (where.taskId !== undefined && r.taskId !== where.taskId)
            return false
          if ('deletedAt' in where && r.deletedAt !== where.deletedAt)
            return false
          return true
        })
      }),
      updateMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {}
        const matched = rows.filter(r => {
          if (where.taskId !== undefined && r.taskId !== where.taskId)
            return false
          if ('deletedAt' in where && r.deletedAt !== where.deletedAt)
            return false
          if ('confirmedAt' in where && r.confirmedAt !== where.confirmedAt)
            return false
          return true
        })
        for (const r of matched) Object.assign(r, args.data)
        return { count: matched.length }
      }),
      create: jest.fn(async (args: any) => {
        const row: FakeRow = {
          id: `c-${nextId++}`,
          taskId: args.data.taskId,
          statement: args.data.statement,
          verifierType: args.data.verifierType,
          checkpointer: args.data.checkpointer ?? null,
          evidenceRequired: args.data.evidenceRequired ?? false,
          judgeSteps: args.data.judgeSteps ?? null,
          source: args.data.source,
          addedAtRound: args.data.addedAtRound ?? 0,
          referentKind: args.data.referentKind ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          confirmedAt: args.data.confirmedAt ?? null,
          confirmedByMemberId: args.data.confirmedByMemberId ?? null,
        }
        rows.push(row)
        return row
      }),
      update: jest.fn(async (args: any) => {
        const row = rows.find(r => r.id === args.where.id)
        if (!row) throw new Error(`row ${args.where.id} not found`)
        Object.assign(row, args.data, { updatedAt: new Date() })
        return row
      }),
      delete: jest.fn(async (args: any) => {
        rows = rows.filter(r => r.id !== args.where.id)
        return { id: args.where.id }
      }),
      count: jest.fn(async (args: any) => {
        const where = args?.where ?? {}
        return rows.filter(r => {
          if (where.taskId !== undefined && r.taskId !== where.taskId)
            return false
          if ('deletedAt' in where && r.deletedAt !== where.deletedAt)
            return false
          return true
        }).length
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  return { prisma }
})

jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    maxRoundByTask: jest.fn(async () => 0),
    latestRunsByCriterion: jest.fn(async () => new Map()),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createComment: jest.fn() },
}))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn(async () => null) }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

import type { TaskStatus } from '@prisma/client'
import { taskCriteriaConfirmService } from '@/lib/services/task-criteria-confirm.service'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

const createMock = activityRepository.create as jest.Mock

/** Pull out just the CONTRACT_CONFIRMED calls made to the mocked activityRepository.create. */
function contractConfirmedCalls(): Array<{
  taskId: string
  actorId: string | null
  type: string
  payload: Record<string, unknown>
}> {
  return createMock.mock.calls
    .map(([data]) => data)
    .filter(d => d.type === 'CONTRACT_CONFIRMED')
}

const taskId = 't-789'
const emptyTaskId = 't-empty'
const memberId = 'member-1'

beforeEach(() => {
  reset()
  jest.clearAllMocks()
  seed(taskId, 3)
})

describe('LUM-789 confirmContract', () => {
  it('把全部未删除的 criterion 盖上 confirmedAt + confirmedByMemberId', async () => {
    const result = await taskCriteriaConfirmService.confirmContract(
      taskId,
      memberId,
      'cli'
    )
    expect(result.confirmedCount).toBe(3)
    const rows = await acceptanceCriterionRepository.listByTask(taskId)
    for (const r of rows) {
      expect(r.confirmedAt).not.toBeNull()
      expect(r.confirmedByMemberId).toBe(memberId)
    }
  })

  it('已确认的合同重复确认是幂等的,不报错也不改写原时间戳', async () => {
    await taskCriteriaConfirmService.confirmContract(taskId, memberId, 'cli')
    const first = (await acceptanceCriterionRepository.listByTask(taskId))[0]!
      .confirmedAt
    const again = await taskCriteriaConfirmService.confirmContract(
      taskId,
      memberId,
      'cli'
    )
    expect(again.confirmedCount).toBe(0)
    const second = (await acceptanceCriterionRepository.listByTask(taskId))[0]!
      .confirmedAt
    // Reviewer note: two `new Date()` calls inside the same millisecond would
    // make `.toEqual` pass even if the second confirm *did* overwrite the
    // stamp — `again.confirmedCount === 0` above is what actually pins the
    // no-op, but assert on the exact same object (never reassigned) so this
    // line means what it looks like it means, independent of clock ticks.
    expect(second).toBe(first)
  })

  it('没有合同时抛 400', async () => {
    await expect(
      taskCriteriaConfirmService.confirmContract(emptyTaskId, memberId, 'cli')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('HUMAN_EDIT 修订写入的 criterion 直接带 confirmedAt,无需再确认', async () => {
    await taskCriteriaService.reviseAsHuman(
      taskId,
      [{ statement: '登录页在移动端可用', verifierType: 'HUMAN' }],
      { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
      'IN_PROGRESS' satisfies TaskStatus
    )
    const rows =
      await acceptanceCriterionRepository.listByTaskIncludingDeleted(taskId)
    const created = rows.find(r => r.statement === '登录页在移动端可用')!
    expect(created.confirmedAt).not.toBeNull()
    expect(created.confirmedByMemberId).toBe(memberId)
  })

  // Finding 3: the Step-6 case above only exercises the `toCreate` branch of
  // the auto-confirm stamp (its item carries no `id`). Drive an edit of an
  // *existing* criterion — items WITH ids — so the `toUpdate` branch
  // (task-criteria.service.ts's applyContractDiff, ~line 172-186) is
  // actually exercised too.
  it('HUMAN_EDIT 修订编辑一条已有 criterion(带 id)也直接带上确认戳', async () => {
    const existing = await acceptanceCriterionRepository.listByTask(taskId)
    expect(existing).toHaveLength(3)
    const target = existing[0]!

    // Resubmit the full desired list with every id kept, so this is a pure
    // update (not a create or a delete) — only target's statement changes.
    await taskCriteriaService.reviseAsHuman(
      taskId,
      existing.map(c => ({
        id: c.id,
        statement: c.id === target.id ? '编辑后的说法' : c.statement,
        verifierType: c.verifierType,
        checkpointer: c.checkpointer,
      })),
      { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
      'IN_PROGRESS' satisfies TaskStatus
    )

    const rows = await acceptanceCriterionRepository.listByTask(taskId)
    expect(rows).toHaveLength(3)
    const updated = rows.find(r => r.id === target.id)!
    expect(updated.statement).toBe('编辑后的说法')
    expect(updated.confirmedAt).not.toBeNull()
    expect(updated.confirmedByMemberId).toBe(memberId)
  })

  // Finding 1: without the `cfg.source === 'HUMAN_EDIT'` gate in
  // applyContractDiff, an agent-drafted submission would silently
  // self-confirm too — destroying the "exactly one human touchpoint"
  // premise of this feature. Pin both AGENT_DRAFT code paths to NULL.
  describe('AGENT_DRAFT 写入永不自动确认', () => {
    it('工作开始前的整份替换(submitDraft, workStartedAt=null)不盖确认戳', async () => {
      const existing = await acceptanceCriterionRepository.listByTask(taskId)
      expect(existing).toHaveLength(3)

      await taskCriteriaService.submitDraft(
        taskId,
        [
          {
            statement: 'replacement A',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest',
          },
          {
            statement: 'replacement B',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest',
          },
        ],
        { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
        'TODO' satisfies TaskStatus,
        null
      )

      const rows = await acceptanceCriterionRepository.listByTask(taskId)
      expect(rows).toHaveLength(2)
      for (const r of rows) {
        expect(r.confirmedAt).toBeNull()
        expect(r.confirmedByMemberId).toBeNull()
      }
    })

    it('工作已开始的 identity-preserving diff(submitDraft, workStartedAt≠null)不盖确认戳', async () => {
      const existing = await acceptanceCriterionRepository.listByTask(taskId)
      expect(existing).toHaveLength(3)
      const target = existing[0]!

      // One update (target's statement changes) + one create (no id) in the
      // same submission, so both the toUpdate and toCreate branches of the
      // AGENT_DRAFT diff path run.
      await taskCriteriaService.submitDraft(
        taskId,
        [
          ...existing.map(c => ({
            id: c.id,
            statement:
              c.id === target.id ? 'agent revised statement' : c.statement,
            verifierType: c.verifierType,
            checkpointer: c.checkpointer,
          })),
          {
            statement: 'agent new criterion',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest',
          },
        ],
        { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
        'IN_PROGRESS' satisfies TaskStatus,
        new Date('2026-06-02')
      )

      const rows = await acceptanceCriterionRepository.listByTask(taskId)
      expect(rows).toHaveLength(4)
      for (const r of rows) {
        expect(r.confirmedAt).toBeNull()
        expect(r.confirmedByMemberId).toBeNull()
      }
    })
  })

  // LUM-789 Task 4b: 用户裁定「都记录下来」——confirmedAt/confirmedByMemberId
  // 只能存最新状态,这里的 CONTRACT_CONFIRMED 事件流补上历史。
  describe('CONTRACT_CONFIRMED 追加历史', () => {
    it('首次确认写一条 CONTRACT_CONFIRMED,reconfirm 为 false,criterionIds 等于被盖戳的集合', async () => {
      const existing = await acceptanceCriterionRepository.listByTask(taskId)
      const result = await taskCriteriaConfirmService.confirmContract(
        taskId,
        memberId,
        'cli'
      )
      const calls = contractConfirmedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]!.taskId).toBe(taskId)
      expect(calls[0]!.payload).toMatchObject({
        via: 'cli',
        confirmedCount: result.confirmedCount,
        reconfirm: false,
      })
      expect(
        (calls[0]!.payload.criterionIds as string[]).slice().sort()
      ).toEqual(existing.map(c => c.id).sort())
    })

    it('幂等重复确认(confirmedCount === 0)不写事件', async () => {
      await taskCriteriaConfirmService.confirmContract(taskId, memberId, 'cli')
      expect(contractConfirmedCalls()).toHaveLength(1)

      const again = await taskCriteriaConfirmService.confirmContract(
        taskId,
        memberId,
        'cli'
      )
      expect(again.confirmedCount).toBe(0)
      // No new CONTRACT_CONFIRMED activity from the no-op second call.
      expect(contractConfirmedCalls()).toHaveLength(1)
    })

    // Review finding Q2: the previous version of this test built its mixed
    // confirmed/unconfirmed state by writing `confirmedAt: null` directly
    // through the repository — no product code path ever resets a
    // criterion's confirmedAt to null (the only writers are
    // `confirmAllActive` and the two HUMAN_EDIT stamps), so that scenario was
    // unreachable in production. This version drives the *reachable* path
    // end to end through the real services: confirm the contract, then an
    // AGENT_DRAFT revision (work already started) adds a new criterion —
    // proven by the 'AGENT_DRAFT 写入永不自动确认' suite above to land
    // unconfirmed — then confirm again.
    it('确认后由 AGENT_DRAFT 新增一条未确认的 criterion,重新确认时 reconfirm 为 true 且原事件仍在(历史是追加的)', async () => {
      const existing = await acceptanceCriterionRepository.listByTask(taskId)
      expect(existing).toHaveLength(3)

      const first = await taskCriteriaConfirmService.confirmContract(
        taskId,
        memberId,
        'cli'
      )
      expect(first.confirmedCount).toBe(3)

      // Work already started (workStartedAt != null) → identity-preserving
      // diff: the 3 existing rows are resubmitted unchanged (no update), one
      // new row is added with no id (create). AGENT_DRAFT never auto-confirms
      // (see the suite above), so the new row lands with confirmedAt: null —
      // this is the only way an already-confirmed contract picks up an
      // unconfirmed row in production.
      await taskCriteriaService.submitDraft(
        taskId,
        [
          ...existing.map(c => ({
            id: c.id,
            statement: c.statement,
            verifierType: c.verifierType,
            checkpointer: c.checkpointer,
          })),
          {
            statement: '新增一条未确认的验收项',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest',
          },
        ],
        { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
        'IN_PROGRESS' satisfies TaskStatus,
        new Date('2026-06-02')
      )

      const afterDraft = await acceptanceCriterionRepository.listByTask(taskId)
      expect(afterDraft).toHaveLength(4)
      const added = afterDraft.find(c => !existing.some(e => e.id === c.id))!
      expect(added.confirmedAt).toBeNull()
      // Still exactly the one CONTRACT_CONFIRMED event from step 1 — the
      // AGENT_DRAFT add wrote no confirmation event of its own.
      expect(contractConfirmedCalls()).toHaveLength(1)

      const second = await taskCriteriaConfirmService.confirmContract(
        taskId,
        memberId,
        'cli'
      )
      // Only the newly added row gets stamped — this is what falsifies an
      // "overwrite" implementation: if `confirmAllActive` re-stamped every
      // active row instead of only the still-unconfirmed one, this would be
      // 4, not 1 (see Fix wave notes in task-4b-report.md for a demonstrated
      // failure under that mutation).
      expect(second.confirmedCount).toBe(1)

      const calls = contractConfirmedCalls()
      // The append-only load: two distinct events exist, and the FIRST one's
      // content is exactly what it was when written — untouched by the
      // second confirm — rather than being merged/overwritten into one row.
      expect(calls).toHaveLength(2)
      expect(calls[0]!.payload).toMatchObject({
        via: 'cli',
        confirmedCount: 3,
        reconfirm: false,
      })
      expect(
        (calls[0]!.payload.criterionIds as string[]).slice().sort()
      ).toEqual(existing.map(c => c.id).sort())
      expect(calls[1]!.payload).toMatchObject({
        via: 'cli',
        confirmedCount: 1,
        reconfirm: true,
        criterionIds: [added.id],
      })
    })

    it('via 正确区分 web / cli', async () => {
      await taskCriteriaConfirmService.confirmContract(taskId, memberId, 'web')
      expect(contractConfirmedCalls()[0]!.payload.via).toBe('web')
    })

    it('HUMAN_EDIT 自动确认写入 via: HUMAN_EDIT 的 CONTRACT_CONFIRMED', async () => {
      await taskCriteriaService.reviseAsHuman(
        taskId,
        [{ statement: '登录页在移动端可用', verifierType: 'HUMAN' }],
        { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
        'IN_PROGRESS' satisfies TaskStatus
      )
      const calls = contractConfirmedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]!.payload).toMatchObject({ via: 'HUMAN_EDIT' })
    })

    it('HUMAN_EDIT 一次修订触碰多行只写一条 CONTRACT_CONFIRMED,不是每行一条', async () => {
      const existing = await acceptanceCriterionRepository.listByTask(taskId)
      expect(existing).toHaveLength(3)
      const [a, b] = existing

      // Edit two existing rows + add one new row in the same revision — three
      // rows get the auto-confirm stamp in one call.
      await taskCriteriaService.reviseAsHuman(
        taskId,
        [
          ...existing.map(c => ({
            id: c.id,
            statement:
              c.id === a!.id
                ? '编辑后的说法 A'
                : c.id === b!.id
                  ? '编辑后的说法 B'
                  : c.statement,
            verifierType: c.verifierType,
            checkpointer: c.checkpointer,
          })),
          { statement: '新增一条', verifierType: 'HUMAN' },
        ],
        { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
        'IN_PROGRESS' satisfies TaskStatus
      )

      const calls = contractConfirmedCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]!.payload.confirmedCount).toBe(3)
      expect(calls[0]!.payload.criterionIds).toHaveLength(3)
    })

    it('AGENT_DRAFT 写入(submitDraft)不产生 CONTRACT_CONFIRMED', async () => {
      const existing = await acceptanceCriterionRepository.listByTask(taskId)
      await taskCriteriaService.submitDraft(
        taskId,
        [
          ...existing.map(c => ({
            id: c.id,
            statement: 'agent revised',
            verifierType: c.verifierType,
            checkpointer: c.checkpointer,
          })),
        ],
        { actorMemberId: memberId, sourceSessionId: null, origin: 'cli' },
        'IN_PROGRESS' satisfies TaskStatus,
        new Date('2026-06-02')
      )
      expect(contractConfirmedCalls()).toHaveLength(0)
    })
  })
})
