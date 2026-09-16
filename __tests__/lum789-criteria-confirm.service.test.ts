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
    expect(second).toEqual(first)
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
      'IN_PROGRESS' as any
    )
    const rows =
      await acceptanceCriterionRepository.listByTaskIncludingDeleted(taskId)
    const created = rows.find(r => r.statement === '登录页在移动端可用')!
    expect(created.confirmedAt).not.toBeNull()
    expect(created.confirmedByMemberId).toBe(memberId)
  })
})
