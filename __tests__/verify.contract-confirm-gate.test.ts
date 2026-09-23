/** @jest-environment node */
/**
 * LUM-819 (E): 合同确认闸。
 *
 * 1. 一份含未确认标准的合同不开机器验证轮：服务端 409（不写 VerificationRun、
 *    不消耗轮次），CLI 在执行任何 checkpointer 之前就停下。
 * 2. agent 对已确认合同的任何实际改动（改写 / 新增 / 删除）让整份合同回到未
 *    确认；人工 HUMAN_EDIT 修订与原样重提不撤销确认。
 *
 * 用户裁定 #6（2026-09-23）：未确认的合同不许开 verify 轮。只拦开轮，不拦 DONE。
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))
jest.mock('child_process', () => ({ spawnSync: jest.fn() }))

jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn(),
    listByTaskIncludingDeleted: jest.fn(),
    countByTask: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
    unconfirmAllActive: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  ...jest.requireActual('@/lib/repositories/verification-run.repository'),
  verificationRunRepository: {
    createMany: jest.fn(),
    maxRoundByTask: jest.fn(),
    listByTask: jest.fn(),
    latestRunsByCriterion: jest.fn(),
    latestHumanVerdictAction: jest.fn(() => Promise.resolve(null)),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findVerificationMaxRounds: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findStatus: jest.fn(), findHeaderById: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/notifications/notifyWorkspaceOwners', () => ({
  notifyWorkspaceOwners: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createComment: jest.fn() },
}))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))
jest.mock('@/lib/llm/contract-weakening-judge-client', () => ({
  judgeWeakening: jest.fn(),
}))
const TX = { __tx: true }
jest.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(TX)) },
}))

import { spawnSync } from 'child_process'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  assertContractConfirmed,
  taskVerificationService,
} from '@/lib/services/task-verification.service'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { verify, unconfirmedContractMessage } from '@/cli/src/commands/verify'

const repo = acceptanceCriterionRepository as unknown as Record<
  string,
  jest.Mock
>
const runRepo = verificationRunRepository as unknown as Record<
  string,
  jest.Mock
>
const mockSpawn = spawnSync as jest.Mock

const CONFIRMED_AT = new Date('2026-09-23T01:00:00Z')

function criterion(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    taskId: 't-1',
    statement: 'route rejects bad input',
    verifierType: 'MACHINE' as const,
    checkpointer: 'npx jest x.test.ts',
    evidenceRequired: false,
    judgeSteps: null,
    referentKind: 'AGENT_CONSTRUCTED_STATE' as const,
    source: 'AGENT_DRAFT' as const,
    addedAtRound: 0,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    deletedAt: null,
    confirmedAt: CONFIRMED_AT as Date | null,
    confirmedByMemberId: 'm-human' as string | null,
    ...over,
  }
}

function item(
  c: ReturnType<typeof criterion>,
  over: Record<string, unknown> = {}
) {
  return {
    id: c.id,
    statement: c.statement,
    verifierType: c.verifierType,
    checkpointer: c.checkpointer,
    evidenceRequired: c.evidenceRequired,
    referentKind: c.referentKind,
    ...over,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

let writeSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  repo.unconfirmAllActive!.mockResolvedValue(0)
  writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  writeSpy.mockRestore()
  errSpy.mockRestore()
  jest.restoreAllMocks()
})

describe('LUM-819 contract-confirmation gate', () => {
  it('verify refuses an unconfirmed contract without burning a round', async () => {
    // ── server: 409 before any write, no round consumed ─────────────────────
    repo.listByTask!.mockResolvedValue([
      criterion(),
      criterion({
        id: 'c-2',
        verifierType: 'HUMAN',
        checkpointer: null,
        confirmedAt: null,
        confirmedByMemberId: null,
      }),
    ])
    runRepo.maxRoundByTask!.mockResolvedValue(0)
    ;(
      workspaceRepository.findVerificationMaxRounds as jest.Mock
    ).mockResolvedValue(3)

    const refused = taskVerificationService.recordMachineRound(
      't-1',
      'ws-1',
      [
        {
          criterionId: 'c-1',
          verdict: 'PASS',
          evidencePointer: 'cmd:x#exit=0',
        },
      ],
      { actorMemberId: 'm-1', actorClerkId: null, sourceSessionId: null },
      null
    )
    await expect(refused).rejects.toMatchObject({
      status: 409,
      code: 'CONTRACT_UNCONFIRMED',
    })
    await expect(refused).rejects.toThrow(/No round was used/)
    // A HUMAN row counts too: the human confirms the whole contract.
    expect(runRepo.createMany).not.toHaveBeenCalled()
    expect(runRepo.maxRoundByTask).not.toHaveBeenCalled()

    // The pure gate: fully confirmed → no throw.
    expect(() =>
      assertContractConfirmed([{ confirmedAt: CONFIRMED_AT }])
    ).not.toThrow()

    // ── CLI: stops before running any checkpointer ──────────────────────────
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async url => {
        const u = String(url)
        if (u.endsWith('/criteria'))
          return jsonResponse(200, {
            criteria: [
              {
                id: 'c-1',
                statement: 'route rejects bad input',
                verifierType: 'MACHINE',
                checkpointer: 'npx jest x.test.ts',
                evidenceRequired: false,
                source: 'AGENT_DRAFT',
                addedAtRound: 0,
                confirmedAt: null,
              },
            ],
          })
        throw new Error(`unexpected fetch ${u}`)
      })
    expect(await verify('LUM-9')).toBe(1)
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(
      fetchSpy.mock.calls.some(c => String(c[0]).endsWith('/verify'))
    ).toBe(false)
    const out = writeSpy.mock.calls.map(c => String(c[0])).join('')
    expect(out).toContain('lumo task criteria confirm LUM-9')
    expect(out).toContain('No checkpointer was run and no round was used')

    // An older server that omits confirmedAt never blocks client-side.
    expect(unconfirmedContractMessage('LUM-9', [{}])).toBeNull()
    expect(
      unconfirmedContractMessage('LUM-9', [{ confirmedAt: '2026-09-23' }])
    ).toBeNull()
  })

  it('an agent edit returns a confirmed contract to unconfirmed', async () => {
    const c1 = criterion()
    const c2 = criterion({ id: 'c-2', statement: 'second outcome' })
    const attribution = { actorMemberId: 'm-agent', sourceSessionId: null }
    const started = new Date('2026-09-20')
    runRepo.maxRoundByTask!.mockResolvedValue(0)
    runRepo.latestRunsByCriterion!.mockResolvedValue(new Map())
    repo.create!.mockImplementation(async (d: Record<string, unknown>) => ({
      ...criterion(),
      ...d,
      id: 'c-new',
    }))

    const agentEdit = async (items: ReturnType<typeof item>[]) => {
      repo.unconfirmAllActive!.mockClear()
      repo.listByTask!.mockResolvedValue([c1, c2])
      await taskCriteriaService.submitDraft(
        't-1',
        items as never,
        attribution as never,
        'IN_PROGRESS',
        started
      )
      return repo.unconfirmAllActive!.mock.calls.length
    }

    // reword, add, delete — each one revokes the confirmation of the whole contract
    expect(await agentEdit([item(c1, { statement: 'looser' }), item(c2)])).toBe(
      1
    )
    expect(
      await agentEdit([
        item(c1),
        item(c2),
        {
          statement: 'new',
          verifierType: 'HUMAN',
          checkpointer: null,
        } as never,
      ])
    ).toBe(1)
    expect(await agentEdit([item(c1)])).toBe(1)
    expect(repo.unconfirmAllActive).toHaveBeenLastCalledWith('t-1', TX)

    // an identical resubmit after work started is not a change
    expect(await agentEdit([item(c1), item(c2)])).toBe(0)

    // before work started: identical resubmit is a no-op (no delete/recreate
    // that would silently drop the stamps) …
    repo.listByTask!.mockResolvedValue([c1, c2])
    repo.delete!.mockClear()
    await taskCriteriaService.submitDraft(
      't-1',
      [item(c1), item(c2)] as never,
      attribution as never,
      'TODO',
      null
    )
    expect(repo.delete).not.toHaveBeenCalled()
    // … while a changed pre-start draft is recreated without any stamp.
    repo.create!.mockClear()
    await taskCriteriaService.submitDraft(
      't-1',
      [item(c1, { statement: 'changed' })] as never,
      attribution as never,
      'TODO',
      null
    )
    expect(repo.delete).toHaveBeenCalledTimes(2)
    for (const call of repo.create!.mock.calls)
      expect(call[0]).not.toHaveProperty('confirmedAt')

    // a human (HUMAN_EDIT) revision never revokes — it re-stamps what it touches
    repo.unconfirmAllActive!.mockClear()
    repo.listByTask!.mockResolvedValue([c1, c2])
    await taskCriteriaService.reviseAsHuman(
      't-1',
      [item(c1, { statement: 'human reworded' }), item(c2)] as never,
      { actorMemberId: 'm-human', sourceSessionId: null } as never,
      'IN_PROGRESS'
    )
    expect(repo.unconfirmAllActive).not.toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ confirmedByMemberId: 'm-human' }),
      TX
    )
  })
})
