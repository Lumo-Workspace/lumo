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
      memberId
    )
    expect(result.confirmedCount).toBe(3)
    const rows = await acceptanceCriterionRepository.listByTask(taskId)
    for (const r of rows) {
      expect(r.confirmedAt).not.toBeNull()
      expect(r.confirmedByMemberId).toBe(memberId)
    }
  })

  it('已确认的合同重复确认是幂等的,不报错也不改写原时间戳', async () => {
    await taskCriteriaConfirmService.confirmContract(taskId, memberId)
    const first = (await acceptanceCriterionRepository.listByTask(taskId))[0]!
      .confirmedAt
    const again = await taskCriteriaConfirmService.confirmContract(
      taskId,
      memberId
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
      taskCriteriaConfirmService.confirmContract(emptyTaskId, memberId)
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
})
