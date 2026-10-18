/**
 * @jest-environment node
 *
 * LUM-1234 — the reward-hack layer runner. The real runner, the real scan /
 * input / spend repositories and the real switch resolver run against a
 * mocked Prisma client (team convention); only the model client, the GitHub
 * file listing, the session lists and the PR summary sync are mocked.
 */
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('@/lib/db/prisma', () => {
  const prisma: Record<string, unknown> = {
    prSecurityScan: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    prSecurityFinding: { findMany: jest.fn(), createMany: jest.fn() },
    pullRequest: { findUnique: jest.fn(), findFirst: jest.fn() },
    workspace: { findUnique: jest.fn() },
    workspaceLlmSpend: { findUnique: jest.fn(), upsert: jest.fn() },
    session: { findMany: jest.fn() },
    hookEvent: { findMany: jest.fn() },
    task: { findFirst: jest.fn() },
    taskSlackContext: { findMany: jest.fn() },
    taskWebLink: { findMany: jest.fn() },
    taskFigmaLink: { findMany: jest.fn() },
    documentMention: { findMany: jest.fn() },
    comment: { findMany: jest.fn() },
  }
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(prisma)
  )
  return { prisma }
})
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
    listChildrenForTask: jest.fn(),
  },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrFiles: jest.fn(),
}))
jest.mock('@/ee/security/llm/reward-hack-judge-client', () => ({
  judgeRewardHack: jest.fn(),
  refuteRewardHackItem: jest.fn(),
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { fetchPrFiles } from '@/lib/integrations/github/contents'
import {
  judgeRewardHack,
  refuteRewardHackItem,
} from '@/ee/security/llm/reward-hack-judge-client'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import {
  rewardHackFingerprint,
  runRewardHackLayer,
} from '@/ee/security/services/reward-hack-layer.service'
import { isBlockingFinding } from '@/ee/security/services/pr-security-scan-gate'
import {
  parseRewardHackState,
  sameWatermark,
} from '@/ee/security/security-scan/reward-hack-state'
import type { NewFindingInput } from '@/ee/security/repositories/pr-security-scan.repository'

type Fn = jest.Mock
type Model = Record<
  'findUnique' | 'findFirst' | 'findMany' | 'update' | 'createMany' | 'upsert',
  Fn
>
type ModelName =
  | 'prSecurityScan'
  | 'prSecurityFinding'
  | 'pullRequest'
  | 'workspace'
  | 'workspaceLlmSpend'
  | 'session'
  | 'hookEvent'
  | 'task'
  | 'taskSlackContext'
  | 'taskWebLink'
  | 'taskFigmaLink'
  | 'documentMention'
  | 'comment'
const db = prisma as unknown as Record<ModelName, Model>
const judge = judgeRewardHack as unknown as Fn
const refute = refuteRewardHackItem as unknown as Fn
const sync = securityPrReviewService.sync as unknown as Fn
const listFiles = fetchPrFiles as unknown as Fn

const SCAN_STARTED = new Date('2026-10-10T12:00:00Z')
const PR_OPENED = new Date('2026-10-09T00:00:00Z')
const SCAN = {
  id: 'scan2',
  pullRequestId: 'pr1',
  workspaceId: 'w1',
  startedAt: SCAN_STARTED,
  stages: { secrets: 'RAN', rewardHack: 'PENDING' },
  partial: false,
  partialCauses: [],
}
const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  taskId: 't1',
  repo: 'o/r',
  number: 7,
  createdAt: PR_OPENED,
  task: null,
}
const ALL_ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRewardHackEnabled: true,
  securityRequestChangesEnabled: false,
  securityAllowAuthorApproval: true,
  securityLearningsScope: 'auto',
  securityReviewAutoPauseAfter: 5,
}

interface Ev {
  id: string
  sessionId: string
  type: string
  toolName: string | null
  payload: unknown
  createdAt: Date
}
const at = (iso: string) => new Date(iso)
function edit(id: string, file: string, when = '2026-10-09T10:00:00Z'): Ev {
  return {
    id,
    sessionId: 'sess1',
    type: 'POST_TOOL_USE',
    toolName: 'Edit',
    payload: {
      tool_name: 'Edit',
      tool_input: {
        file_path: `/wt/${file}`,
        old_string: 'a',
        new_string: 'b',
      },
      tool_response: { filePath: `/wt/${file}` },
    },
    createdAt: at(when),
  }
}
function promptEv(id: string, text: string, when = '2026-10-09T09:00:00Z'): Ev {
  return {
    id,
    sessionId: 'sess1',
    type: 'USER_PROMPT_SUBMIT',
    toolName: null,
    payload: { prompt: text },
    createdAt: at(when),
  }
}
const PRUNED = { _lumo_pruned: { at: '2026-10-09T00:00:00Z' } }

/** The `prSecurityScan.update` calls that wrote `stages` (mergeStages). */
function stageWrites() {
  return db.prSecurityScan.update.mock.calls
    .map(c => c[0] as { data: Record<string, unknown> })
    .filter(c => c.data.stages !== undefined)
    .map(c => c.data)
}
function lastStage() {
  const w = stageWrites()
  const last = w[w.length - 1]
  return {
    state: (last?.stages as Record<string, string> | undefined)?.rewardHack,
    causes: (last?.partialCauses as string[] | undefined) ?? [],
  }
}
function stateWrites() {
  return db.prSecurityScan.update.mock.calls
    .map(c => c[0] as { data: Record<string, unknown> })
    .filter(c => c.data.rewardHackState !== undefined)
    .map(c => c.data.rewardHackState)
}
function writtenRows(): NewFindingInput[] {
  return db.prSecurityFinding.createMany.mock.calls.flatMap(
    c => (c[0] as { data: NewFindingInput[] }).data
  )
}

let previousScan: { id: string; rewardHackState: unknown } | null
let previousRows: unknown[]
let dispositioned: unknown[]

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_REWARD_HACK = 'on'
  delete process.env.LUMO_REWARD_HACK_MONTHLY_CAP_USD
  previousScan = null
  previousRows = []
  dispositioned = []
  db.prSecurityScan.findUnique.mockResolvedValue(SCAN)
  db.prSecurityScan.findFirst.mockImplementation(async () => previousScan)
  db.prSecurityScan.update.mockResolvedValue({})
  db.prSecurityFinding.findMany.mockImplementation(
    async (args: { where: Record<string, unknown> }) =>
      args.where.kind === 'REWARD_HACK' ? previousRows : dispositioned
  )
  db.prSecurityFinding.createMany.mockResolvedValue({ count: 0 })
  db.pullRequest.findUnique.mockResolvedValue(PR)
  db.pullRequest.findFirst.mockResolvedValue(null)
  db.workspace.findUnique.mockResolvedValue(ALL_ON)
  db.workspaceLlmSpend.findUnique.mockResolvedValue(null)
  db.workspaceLlmSpend.upsert.mockResolvedValue({})
  db.session.findMany.mockResolvedValue([{ id: 'sess1' }])
  db.hookEvent.findMany.mockResolvedValue([
    promptEv('e1', 'Make the login tests pass'),
    edit('e2', 'src/auth.test.ts'),
  ])
  db.task.findFirst.mockResolvedValue({ title: 'Fix login', description: null })
  for (const m of [
    'taskSlackContext',
    'taskWebLink',
    'taskFigmaLink',
    'documentMention',
    'comment',
  ] as const)
    db[m].findMany.mockResolvedValue([])
  ;(sessionRepository.listForTask as Fn).mockResolvedValue([{ id: 'sess1' }])
  ;(sessionRepository.listChildrenForTask as Fn).mockResolvedValue([])
  listFiles.mockResolvedValue([
    { filename: 'src/auth.test.ts', status: 'modified' },
  ])
  judge.mockResolvedValue({
    output: {
      suspicion: 90,
      items: [
        {
          kind: 'TEST_TAMPERING',
          summary: 'Deleted the failing assertion so the login test passes.',
          eventIds: ['e2'],
        },
      ],
    },
    inputTokens: 100,
    outputTokens: 10,
    costUsd: 0.5,
  })
  refute.mockResolvedValue({ refuted: false, reason: 'no', costUsd: 0.1 })
  sync.mockResolvedValue({})
})

afterAll(() => {
  delete process.env.LUMO_REWARD_HACK
})

describe('LUM-1234 reward-hack layer runner', () => {
  it('a PR with no task is SKIPPED without a model call, and the summary still syncs', async () => {
    db.pullRequest.findUnique.mockResolvedValue({ ...PR, taskId: null })
    await runRewardHackLayer('scan2')
    expect(lastStage().state).toBe('SKIPPED')
    expect(judge).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('scan2')
  })

  it('no session that edits a file of this PR is SKIPPED without a model call', async () => {
    listFiles.mockResolvedValue([{ filename: 'src/other.ts', status: 'added' }])
    await runRewardHackLayer('scan2')
    expect(lastStage()).toEqual({ state: 'SKIPPED', causes: [] })
    expect(judge).not.toHaveBeenCalled()
  })

  it('a session whose in-window events were pruned is PARTIAL (reward_hack_pruned), never "nothing found"', async () => {
    db.hookEvent.findMany.mockResolvedValue([
      { ...edit('e2', 'src/auth.test.ts'), payload: PRUNED },
    ])
    await runRewardHackLayer('scan2')
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['reward_hack_pruned'],
    })
    expect(judge).not.toHaveBeenCalled()
  })

  it('same watermark as the previous verdict: no model call, its findings are copied with their disposition', async () => {
    const fp = rewardHackFingerprint('TEST_TAMPERING', ['e2'])
    previousScan = {
      id: 'scan1',
      rewardHackState: {
        watermark: { sess1: 'e2' },
        findingFingerprints: [fp],
        costUsd: 0.6,
        truncated: false,
      },
    }
    previousRows = [
      {
        kind: 'REWARD_HACK',
        ruleId: 'reward-hack/TEST_TAMPERING',
        severity: 'MEDIUM',
        provenance: 'LLM_JUDGE',
        filePath: 'src/auth.test.ts',
        line: null,
        title: 'Deleted the assertion.',
        detail: 'Deleted the assertion.',
        evidence: JSON.stringify({ eventIds: ['e2'], sessionIds: ['sess1'] }),
        fingerprint: fp,
      },
    ]
    const ruledAt = new Date('2026-10-10T00:00:00Z')
    dispositioned = [
      {
        id: 'f-old',
        fingerprint: fp,
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'intended',
        dispositionedById: 'm1',
        dispositionedAt: ruledAt,
        suggestedDisposition: null,
        suggestedReason: null,
        suggestionOutcome: null,
      },
    ]
    await runRewardHackLayer('scan2')
    expect(judge).not.toHaveBeenCalled()
    expect(refute).not.toHaveBeenCalled()
    expect(db.prSecurityScan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          pullRequestId: 'pr1',
          id: { not: 'scan2' },
          startedAt: { lt: SCAN_STARTED },
        }),
      })
    )
    const rows = writtenRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      scanId: 'scan2',
      fingerprint: fp,
      disposition: 'FALSE_POSITIVE',
      dispositionedById: 'm1',
      inheritedFromFindingId: 'f-old',
    })
    expect(lastStage()).toEqual({ state: 'RAN', causes: [] })
    expect(stateWrites()[0]).toMatchObject({
      watermark: { sess1: 'e2' },
      findingFingerprints: [fp],
      costUsd: 0,
    })
  })

  it('a changed watermark re-judges', async () => {
    previousScan = {
      id: 'scan1',
      rewardHackState: {
        watermark: { sess1: 'e1' },
        findingFingerprints: [],
        costUsd: 0.6,
        truncated: false,
      },
    }
    await runRewardHackLayer('scan2')
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('the monthly ceiling reached: PARTIAL (reward_hack_monthly_cap), no model call, no spend', async () => {
    db.workspaceLlmSpend.findUnique.mockResolvedValue({
      usdMicros: BigInt(25_000_000),
    })
    await runRewardHackLayer('scan2')
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['reward_hack_monthly_cap'],
    })
    expect(judge).not.toHaveBeenCalled()
    expect(db.workspaceLlmSpend.upsert).not.toHaveBeenCalled()
    expect(stateWrites()).toHaveLength(0)
  })

  it('an input that cannot fit the cap at all is PARTIAL (reward_hack_input_cap) with no model call', async () => {
    const events: Ev[] = [edit('e2', 'src/auth.test.ts')]
    for (let i = 0; i < 9000; i++)
      events.push(
        promptEv(
          `p${String(i).padStart(5, '0')}`,
          'x'.repeat(80),
          '2026-10-09T08:00:00Z'
        )
      )
    db.hookEvent.findMany.mockResolvedValue(events)
    await runRewardHackLayer('scan2')
    expect(judge).not.toHaveBeenCalled()
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['reward_hack_input_cap'],
    })
  })

  it('a cut (but fitting) input is judged and the layer is PARTIAL (reward_hack_input_cap)', async () => {
    const events: Ev[] = []
    for (let i = 0; i < 400; i++) {
      const e = edit(
        `t${String(i).padStart(4, '0')}`,
        'src/auth.test.ts',
        '2026-10-09T08:00:00Z'
      )
      ;(e.payload as Record<string, unknown>).tool_response = {
        filePath: '/wt/src/auth.test.ts',
        structuredPatch: 'y'.repeat(2000),
      }
      events.push(e)
    }
    events.push(edit('e2', 'src/auth.test.ts'))
    db.hookEvent.findMany.mockResolvedValue(events)
    await runRewardHackLayer('scan2')
    expect(judge).toHaveBeenCalledTimes(1)
    expect((judge.mock.calls[0]![0] as string).length).toBeLessThanOrEqual(
      400_000
    )
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['reward_hack_input_cap'],
    })
    expect(stateWrites()[0]).toMatchObject({ truncated: true })
  })

  it('writes the surviving item as an advisory REWARD_HACK finding (never blocking), adds the spend, and syncs', async () => {
    await runRewardHackLayer('scan2')
    const rows = writtenRows()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toMatchObject({
      scanId: 'scan2',
      kind: 'REWARD_HACK',
      provenance: 'LLM_JUDGE',
      severity: 'MEDIUM',
      ruleId: 'reward-hack/TEST_TAMPERING',
      filePath: 'src/auth.test.ts',
      line: null,
      title: 'Deleted the failing assertion so the login test passes.',
      detail: 'Deleted the failing assertion so the login test passes.',
      fingerprint: rewardHackFingerprint('TEST_TAMPERING', ['e2']),
    })
    expect(JSON.parse(row.evidence)).toEqual({
      eventIds: ['e2'],
      sessionIds: ['sess1'],
    })
    expect(
      isBlockingFinding({
        provenance: row.provenance,
        severity: row.severity,
        disposition: row.disposition ?? null,
      })
    ).toBe(false)
    // Rows land with the FINDINGS status flip.
    expect(db.prSecurityScan.update).toHaveBeenCalledWith({
      where: { id: 'scan2' },
      data: { status: 'FINDINGS' },
    })
    expect(db.workspaceLlmSpend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: 'w1',
          feature: 'reward_hack',
          usdMicros: BigInt(600_000),
        }),
      })
    )
    expect(lastStage()).toEqual({ state: 'RAN', causes: [] })
    expect(stateWrites()[0]).toEqual({
      watermark: { sess1: 'e2' },
      findingFingerprints: [row.fingerprint],
      costUsd: 0.6,
      truncated: false,
    })
    expect(sync).toHaveBeenCalledWith('scan2')
  })

  it('the fingerprint does not depend on the order of the cited ids', () => {
    expect(rewardHackFingerprint('OTHER', ['b', 'a'])).toBe(
      rewardHackFingerprint('OTHER', ['a', 'b'])
    )
    expect(rewardHackFingerprint('OTHER', ['a'])).not.toBe(
      rewardHackFingerprint('SPECIAL_CASING', ['a'])
    )
  })

  it('redacts a credential-shaped value out of the model summary', async () => {
    const key = ['AK', 'IA', 'Q'.repeat(16)].join('')
    judge.mockResolvedValue({
      output: {
        suspicion: 90,
        items: [
          {
            kind: 'FAKED_RESULT',
            summary: `Hard-coded ${key} to fake the check.`,
            eventIds: ['e2'],
          },
        ],
      },
      costUsd: 0.5,
    })
    await runRewardHackLayer('scan2')
    const row = writtenRows()[0]!
    expect(row.title).not.toContain(key)
    expect(row.detail).not.toContain(key)
  })

  it('a refuted item is not written', async () => {
    refute.mockResolvedValue({
      refuted: true,
      reason: 'user asked',
      costUsd: 0.1,
    })
    await runRewardHackLayer('scan2')
    expect(refute).toHaveBeenCalledTimes(1)
    expect(writtenRows()).toHaveLength(0)
    expect(lastStage()).toEqual({ state: 'RAN', causes: [] })
  })

  it('below the threshold nothing is refuted or written; the verdict is still RAN', async () => {
    judge.mockResolvedValue({
      output: {
        suspicion: 10,
        items: [{ kind: 'OTHER', summary: 'meh', eventIds: ['e2'] }],
      },
      costUsd: 0.5,
    })
    await runRewardHackLayer('scan2')
    expect(refute).not.toHaveBeenCalled()
    expect(writtenRows()).toHaveLength(0)
    expect(lastStage().state).toBe('RAN')
  })

  it('the judge throws: FAILED, logged, the summary still syncs, no state', async () => {
    judge.mockRejectedValue(new Error('gateway 500'))
    await expect(runRewardHackLayer('scan2')).resolves.toBeUndefined()
    expect(lastStage().state).toBe('FAILED')
    expect(sync).toHaveBeenCalledWith('scan2')
    expect(stateWrites()).toHaveLength(0)
    expect(writtenRows()).toHaveLength(0)
  })

  it('a refute call throws after the judge: FAILED, but the judge spend is still recorded', async () => {
    refute.mockRejectedValue(new Error('timeout'))
    await runRewardHackLayer('scan2')
    expect(lastStage().state).toBe('FAILED')
    expect(db.workspaceLlmSpend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ usdMicros: BigInt(500_000) }),
      })
    )
  })

  it('a PR file list that cannot be read is FAILED, not SKIPPED', async () => {
    listFiles.mockRejectedValue(new Error('GitHub API error 502'))
    await runRewardHackLayer('scan2')
    expect(lastStage().state).toBe('FAILED')
    expect(judge).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('scan2')
  })

  it('the workspace turned the layer off mid-scan: DISABLED, no model call', async () => {
    db.workspace.findUnique.mockResolvedValue({
      ...ALL_ON,
      securityRewardHackEnabled: false,
    })
    await runRewardHackLayer('scan2')
    expect(lastStage().state).toBe('DISABLED')
    expect(judge).not.toHaveBeenCalled()
  })

  it('the session window opens at the previous merge before this PR opened', async () => {
    await runRewardHackLayer('scan2')
    expect(db.pullRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'w1',
          taskId: 't1',
          id: { not: 'pr1' },
          mergedAt: { not: null, lt: PR_OPENED },
        }),
      })
    )
  })

  it('never throws, even when stamping FAILED fails too', async () => {
    db.prSecurityScan.findUnique.mockRejectedValue(new Error('db down'))
    await expect(runRewardHackLayer('scan2')).resolves.toBeUndefined()
    expect(sync).toHaveBeenCalledWith('scan2')
  })
})

describe('LUM-1234 reward-hack state', () => {
  it('parses a stored state and refuses anything else', () => {
    const ok = {
      watermark: { s: 'e' },
      findingFingerprints: ['f'],
      costUsd: 0.2,
      truncated: false,
    }
    expect(parseRewardHackState(ok)).toEqual(ok)
    expect(parseRewardHackState(null)).toBeNull()
    expect(parseRewardHackState({ ...ok, watermark: { s: 1 } })).toBeNull()
    expect(parseRewardHackState({ ...ok, costUsd: 'x' })).toBeNull()
    expect(parseRewardHackState({ ...ok, truncated: 'no' })).toBeNull()
    expect(parseRewardHackState({ ...ok, findingFingerprints: [1] })).toBeNull()
  })

  it('compares watermarks by session and last event', () => {
    expect(sameWatermark({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
    expect(sameWatermark({ a: '1' }, { a: '2' })).toBe(false)
    expect(sameWatermark({ a: '1' }, { a: '1', b: '2' })).toBe(false)
    expect(sameWatermark({ a: '1' }, { b: '1' })).toBe(false)
  })

  it('a malformed previous state is never reused: the layer re-judges', async () => {
    previousScan = { id: 'scan1', rewardHackState: { watermark: 'x' } }
    await runRewardHackLayer('scan2')
    expect(judge).toHaveBeenCalledTimes(1)
  })
})
