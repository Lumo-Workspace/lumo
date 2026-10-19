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
    workspaceLlmSpend: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
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
// The stale sweep's module also drives hunt runs and VMs: never touched here.
jest.mock('@/ee/security/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))
jest.mock('@/ee/security/integrations/vercel-sandbox', () => ({
  stopRepoSandboxesByTag: jest.fn(),
}))
jest.mock('@/ee/security/services/security-hunt-start', () => ({
  startSecurityHunt: jest.fn(),
  cancelHuntRun: jest.fn(),
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
  REWARD_HACK_MAX_REFUTES,
  rewardHackFingerprint,
  runRewardHackLayer,
} from '@/ee/security/services/reward-hack-layer.service'
import { estimateRhCallUsd } from '@/ee/security/security-scan/reward-hack-cost'
import {
  REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS,
  REWARD_HACK_SYSTEM_PROMPT,
  REWARD_HACK_VERSION,
} from '@/ee/security/security-scan/reward-hack-prompts'
import {
  REWARD_HACK_PENDING_DEAD_MS,
  securityHuntOpsService,
} from '@/ee/security/services/security-hunt-ops.service'
import { isBlockingFinding } from '@/ee/security/services/pr-security-scan-gate'
import {
  parseRewardHackState,
  sameWatermark,
} from '@/ee/security/security-scan/reward-hack-state'
import type { NewFindingInput } from '@/ee/security/repositories/pr-security-scan.repository'

type Fn = jest.Mock
type Model = Record<
  | 'findUnique'
  | 'findFirst'
  | 'findMany'
  | 'update'
  | 'createMany'
  | 'upsert'
  | 'updateMany',
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

/** The workspace's month row in the spend ledger, micro-USD. */
let ledgerMicros: bigint
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
  ledgerMicros = BigInt(0)
  db.workspaceLlmSpend.findUnique.mockImplementation(async () =>
    ledgerMicros > BigInt(0) ? { usdMicros: ledgerMicros } : null
  )
  db.workspaceLlmSpend.upsert.mockImplementation(
    async (a: { update: { usdMicros: { increment: bigint } } }) => {
      ledgerMicros += a.update.usdMicros.increment
      return { usdMicros: ledgerMicros }
    }
  )
  db.workspaceLlmSpend.updateMany.mockImplementation(
    async (a: { data: { usdMicros: { decrement: bigint } } }) => {
      ledgerMicros -= a.data.usdMicros.decrement
      return { count: 1 }
    }
  )
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

  it('a session whose in-window events were pruned is PARTIAL (REWARD_HACK_PRUNED), never "nothing found"', async () => {
    db.hookEvent.findMany.mockResolvedValue([
      { ...edit('e2', 'src/auth.test.ts'), payload: PRUNED },
    ])
    await runRewardHackLayer('scan2')
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_PRUNED'],
    })
    expect(judge).not.toHaveBeenCalled()
  })

  it('same watermark as the previous verdict: no model call, its findings are copied with their disposition', async () => {
    const fp = rewardHackFingerprint('TEST_TAMPERING', ['src/auth.test.ts'])
    previousScan = {
      id: 'scan1',
      rewardHackState: {
        version: REWARD_HACK_VERSION,
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

  it('the monthly ceiling reached: PARTIAL (REWARD_HACK_MONTHLY_CAP), no model call, no spend', async () => {
    db.workspaceLlmSpend.findUnique.mockResolvedValue({
      usdMicros: BigInt(25_000_000),
    })
    await runRewardHackLayer('scan2')
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_MONTHLY_CAP'],
    })
    expect(judge).not.toHaveBeenCalled()
    expect(db.workspaceLlmSpend.upsert).not.toHaveBeenCalled()
    expect(stateWrites()).toHaveLength(0)
  })

  it('an input that cannot fit the cap at all is PARTIAL (REWARD_HACK_INPUT_CAP) with no model call', async () => {
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
      causes: ['REWARD_HACK_INPUT_CAP'],
    })
  })

  it('a cut (but fitting) input is judged and the layer is PARTIAL (REWARD_HACK_INPUT_CAP)', async () => {
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
      causes: ['REWARD_HACK_INPUT_CAP'],
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
      // Our fixed copy (kind + PR file) — never the model's prose.
      title: 'Agent behavior: Weakened or bypassed tests in src/auth.test.ts',
      detail: 'Deleted the failing assertion so the login test passes.',
      fingerprint: rewardHackFingerprint('TEST_TAMPERING', [
        'src/auth.test.ts',
      ]),
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
      data: expect.objectContaining({ status: 'FINDINGS' }),
    })
    // One write: rows, state and stage land together.
    expect(db.prSecurityScan.update).toHaveBeenCalledTimes(1)
    // Estimates charged up front, settled to the reported 0.5 + 0.1.
    expect(db.workspaceLlmSpend.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: 'w1',
          feature: 'reward_hack',
        }),
      })
    )
    expect(ledgerMicros).toBe(BigInt(600_000))
    expect(lastStage()).toEqual({ state: 'RAN', causes: [] })
    expect(stateWrites()[0]).toEqual({
      version: REWARD_HACK_VERSION,
      watermark: { sess1: 'e2' },
      findingFingerprints: [row.fingerprint],
      costUsd: 0.6,
      truncated: false,
    })
    expect(sync).toHaveBeenCalledWith('scan2')
  })

  it('the fingerprint is the kind plus the set of PR files, in any order', () => {
    expect(rewardHackFingerprint('OTHER', ['b.ts', 'a.ts'])).toBe(
      rewardHackFingerprint('OTHER', ['a.ts', 'b.ts', 'a.ts'])
    )
    expect(rewardHackFingerprint('OTHER', ['a.ts'])).not.toBe(
      rewardHackFingerprint('SPECIAL_CASING', ['a.ts'])
    )
  })

  it('a re-judge citing different event ids for the same behaviour keeps the fingerprint, so the disposition carries over', async () => {
    db.hookEvent.findMany.mockResolvedValue([
      promptEv('e1', 'Make the login tests pass'),
      edit('e2', 'src/auth.test.ts'),
      edit('e9', 'src/auth.test.ts', '2026-10-09T11:00:00Z'),
    ])
    judge.mockResolvedValue({
      output: {
        suspicion: 90,
        items: [{ kind: 'TEST_TAMPERING', summary: 'again', eventIds: ['e9'] }],
      },
      costUsd: 0.5,
    })
    const fp = rewardHackFingerprint('TEST_TAMPERING', ['src/auth.test.ts'])
    dispositioned = [
      {
        id: 'f-old',
        fingerprint: fp,
        disposition: 'ACCEPTED_RISK',
        dispositionNote: 'known',
        dispositionedById: 'm1',
        dispositionedAt: new Date('2026-10-10T00:00:00Z'),
        suggestedDisposition: null,
        suggestedReason: null,
        suggestionOutcome: null,
      },
    ]
    await runRewardHackLayer('scan2')
    expect(writtenRows()[0]).toMatchObject({
      fingerprint: fp,
      disposition: 'ACCEPTED_RISK',
      inheritedFromFindingId: 'f-old',
    })
  })

  it('model prose that quotes the prompt never reaches the title', async () => {
    judge.mockResolvedValue({
      output: {
        suspicion: 90,
        items: [
          {
            kind: 'SPECIAL_CASING',
            summary:
              'The user said "our secret launch plan"; the agent hard-coded 42.',
            eventIds: ['e2'],
          },
        ],
      },
      costUsd: 0.5,
    })
    await runRewardHackLayer('scan2')
    const row = writtenRows()[0]!
    expect(row.title).toBe(
      'Agent behavior: Special-cased the checked inputs in src/auth.test.ts'
    )
    expect(row.title).not.toContain('launch plan')
  })

  it('a cached verdict from another prompt version is not reused: the layer re-judges', async () => {
    previousScan = {
      id: 'scan1',
      rewardHackState: {
        version: 'rh-v0',
        watermark: { sess1: 'e2' },
        findingFingerprints: [],
        costUsd: 0.6,
        truncated: false,
      },
    }
    await runRewardHackLayer('scan2')
    expect(judge).toHaveBeenCalledTimes(1)
  })

  it('redacts a credential-shaped value out of the model summary (detail); the title is fixed copy', async () => {
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

  it('a refute call throws after the judge: FAILED, the judge cost and the refute estimate stay booked', async () => {
    refute.mockRejectedValue(new Error('timeout'))
    await runRewardHackLayer('scan2')
    expect(lastStage().state).toBe('FAILED')
    expect(ledgerMicros).toBeGreaterThan(BigInt(500_000))
  })

  it('a PR file list that cannot be read is FAILED, not SKIPPED', async () => {
    listFiles.mockRejectedValue(new Error('GitHub API error 502'))
    await runRewardHackLayer('scan2')
    expect(lastStage().state).toBe('FAILED')
    expect(judge).not.toHaveBeenCalled()
    expect(sync).toHaveBeenCalledWith('scan2')
  })

  it('a cited edit corrected later in the same file (its line is not in the PR diff) is dropped before any refute', async () => {
    const hack = edit('e2', 'src/auth.test.ts')
    ;(hack.payload as { tool_input: Record<string, string> }).tool_input = {
      file_path: '/wt/src/auth.test.ts',
      old_string: 'expect(login(u)).toBe(true)',
      new_string: 'expect(true).toBe(true)',
    }
    db.hookEvent.findMany.mockResolvedValue([promptEv('e1', 'fix it'), hack])
    listFiles.mockResolvedValue([
      {
        filename: 'src/auth.test.ts',
        status: 'modified',
        patch:
          '@@ -1 +1 @@\n-expect(login(u)).toBe(false)\n+expect(login(u)).toBe(true)',
      },
    ])
    await runRewardHackLayer('scan2')
    expect(judge).toHaveBeenCalledTimes(1)
    expect(refute).not.toHaveBeenCalled()
    expect(writtenRows()).toHaveLength(0)
    expect(lastStage()).toEqual({ state: 'RAN', causes: [] })
  })

  it('an edit still in the PR diff is kept, and the refute call gets the current hunks of its file', async () => {
    const hack = edit('e2', 'src/auth.test.ts')
    ;(hack.payload as { tool_input: Record<string, string> }).tool_input = {
      file_path: '/wt/src/auth.test.ts',
      old_string: 'expect(login(u)).toBe(true)',
      new_string: 'expect(true).toBe(true)',
    }
    db.hookEvent.findMany.mockResolvedValue([promptEv('e1', 'fix it'), hack])
    listFiles.mockResolvedValue([
      {
        filename: 'src/auth.test.ts',
        status: 'modified',
        patch:
          '@@ -1 +1 @@\n-expect(login(u)).toBe(true)\n+expect(true).toBe(true)',
      },
      { filename: 'src/unrelated.ts', status: 'modified', patch: '+other' },
    ])
    await runRewardHackLayer('scan2')
    expect(refute).toHaveBeenCalledTimes(1)
    const args = refute.mock.calls[0]![0] as { prDiff: string }
    expect(args.prDiff).toContain('<pr-diff file="src/auth.test.ts">')
    expect(args.prDiff).toContain('+expect(true).toBe(true)')
    expect(args.prDiff).not.toContain('other')
    expect(writtenRows()).toHaveLength(1)
  })

  it('a reused verdict drops a copied row whose cited edit the current diff no longer carries', async () => {
    const hack = edit('e2', 'src/auth.test.ts')
    ;(hack.payload as { tool_input: Record<string, string> }).tool_input = {
      file_path: '/wt/src/auth.test.ts',
      old_string: 'expect(login(u)).toBe(true)',
      new_string: 'expect(true).toBe(true)',
    }
    db.hookEvent.findMany.mockResolvedValue([promptEv('e1', 'fix it'), hack])
    // A human commit fixed the line; the file is still in the PR.
    listFiles.mockResolvedValue([
      {
        filename: 'src/auth.test.ts',
        status: 'modified',
        patch: '@@ -1 +1 @@\n+expect(login(u)).toBe(true)',
      },
    ])
    previousScan = {
      id: 'scan1',
      rewardHackState: {
        version: REWARD_HACK_VERSION,
        watermark: { sess1: 'e2' },
        findingFingerprints: ['fp'],
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
        title: 't',
        detail: 'd',
        evidence: JSON.stringify({ eventIds: ['e2'], sessionIds: ['sess1'] }),
        fingerprint: 'fp',
      },
    ]
    await runRewardHackLayer('scan2')
    expect(judge).not.toHaveBeenCalled()
    expect(writtenRows()).toHaveLength(0)
  })

  it('a Codex session (apply_patch, its only write tool) is judged', async () => {
    db.hookEvent.findMany.mockResolvedValue([
      promptEv('e1', 'make the score test pass'),
      {
        id: 'e2',
        sessionId: 'sess1',
        type: 'POST_TOOL_USE',
        toolName: 'apply_patch',
        payload: {
          tool_name: 'apply_patch',
          tool_input: {
            command:
              '*** Begin Patch\n*** Update File: /wt/src/score.ts\n@@\n+  if (input === 42) return 7\n*** End Patch',
          },
          tool_response: 'Success.',
        },
        createdAt: at('2026-10-09T10:00:00Z'),
      },
    ])
    listFiles.mockResolvedValue([
      {
        filename: 'src/score.ts',
        status: 'modified',
        patch: '@@ -1 +1,2 @@\n+  if (input === 42) return 7',
      },
    ])
    await runRewardHackLayer('scan2')
    expect(judge).toHaveBeenCalledTimes(1)
    expect(judge.mock.calls[0]![0] as string).toContain(
      '[tool call: apply_patch]'
    )
    const row = writtenRows()[0]!
    expect(row.filePath).toBe('src/score.ts')
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

  it('a restart that moved the run token: the stale runner writes nothing and makes no call', async () => {
    await runRewardHackLayer(
      'scan2',
      {},
      { runToken: new Date('2026-10-10T11:00:00Z') }
    )
    expect(judge).not.toHaveBeenCalled()
    expect(db.prSecurityScan.update).not.toHaveBeenCalled()
    expect(db.prSecurityFinding.createMany).not.toHaveBeenCalled()
  })

  it('restarted (or swept) while the model ran: the late result is dropped by the compare-and-set', async () => {
    let reads = 0
    db.prSecurityScan.findUnique.mockImplementation(async () => {
      reads += 1
      // The runner's first read sees its run; the write-time read sees the
      // restarted row (new startedAt, no rewardHack stage yet).
      return reads === 1
        ? SCAN
        : {
            ...SCAN,
            startedAt: new Date('2026-10-10T12:30:00Z'),
            stages: {},
          }
    })
    await runRewardHackLayer('scan2', {}, { runToken: SCAN_STARTED })
    expect(judge).toHaveBeenCalledTimes(1)
    expect(db.prSecurityScan.update).not.toHaveBeenCalled()
    expect(db.prSecurityFinding.createMany).not.toHaveBeenCalled()
  })

  it('a layer no longer PENDING (swept FAILED) is not overwritten', async () => {
    db.prSecurityScan.findUnique.mockResolvedValue({
      ...SCAN,
      stages: { rewardHack: 'FAILED' },
    })
    await runRewardHackLayer('scan2', {}, { runToken: SCAN_STARTED })
    expect(db.prSecurityScan.update).not.toHaveBeenCalled()
  })

  it('a judge call that reports no cost and no usage keeps its estimate booked (never free)', async () => {
    judge.mockResolvedValue({
      output: { suspicion: 0, items: [] },
      costUsd: null,
    })
    await runRewardHackLayer('scan2')
    const prompt = judge.mock.calls[0]![0] as string
    const estimate = estimateRhCallUsd(
      `${REWARD_HACK_SYSTEM_PROMPT}\n${prompt}`,
      REWARD_HACK_JUDGE_MAX_OUTPUT_TOKENS
    )
    expect(ledgerMicros).toBe(BigInt(Math.round(estimate * 1e6)))
    expect(lastStage().state).toBe('RAN')
  })

  it('no reported cost but token usage: booked at list price', async () => {
    judge.mockResolvedValue({
      output: { suspicion: 0, items: [] },
      costUsd: null,
      inputTokens: 100_000,
      outputTokens: 1_000,
    })
    await runRewardHackLayer('scan2')
    // 100k × $3/M + 1k × $15/M
    expect(ledgerMicros).toBe(BigInt(315_000))
  })

  it('the judge estimate is charged BEFORE the call, and stays booked when the call dies', async () => {
    let atCall = BigInt(-1)
    judge.mockImplementation(async () => {
      atCall = ledgerMicros
      throw new Error('function killed')
    })
    await runRewardHackLayer('scan2')
    expect(atCall).toBeGreaterThan(BigInt(0))
    expect(ledgerMicros).toBe(atCall)
    expect(lastStage().state).toBe('FAILED')
  })

  it('another run took the month to the cap before this charge: refunded, no call, PARTIAL (REWARD_HACK_MONTHLY_CAP)', async () => {
    // The read sees room; the concurrent run's spend lands before ours.
    db.workspaceLlmSpend.findUnique.mockResolvedValue(null)
    ledgerMicros = BigInt(25_000_000)
    await runRewardHackLayer('scan2')
    expect(judge).not.toHaveBeenCalled()
    expect(ledgerMicros).toBe(BigInt(25_000_000))
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_MONTHLY_CAP'],
    })
    expect(stateWrites()).toHaveLength(0)
  })

  it('no room left for the refutes: no refute, nothing reported, PARTIAL (REWARD_HACK_MONTHLY_CAP)', async () => {
    judge.mockImplementation(async () => {
      // The judge itself pushed the month past the cap.
      ledgerMicros += BigInt(30_000_000)
      return {
        output: {
          suspicion: 90,
          items: [{ kind: 'OTHER', summary: 's', eventIds: ['e2'] }],
        },
        costUsd: 0.5,
      }
    })
    await runRewardHackLayer('scan2')
    expect(refute).not.toHaveBeenCalled()
    expect(writtenRows()).toHaveLength(0)
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_MONTHLY_CAP'],
    })
  })

  it('refutes at most REWARD_HACK_MAX_REFUTES items, all in parallel', async () => {
    expect(REWARD_HACK_MAX_REFUTES).toBe(3)
    judge.mockResolvedValue({
      output: {
        suspicion: 90,
        items: ['A', 'B', 'C', 'D', 'E'].map(k => ({
          kind: 'OTHER',
          summary: k,
          eventIds: ['e2'],
        })),
      },
      costUsd: 0.5,
    })
    const pending: Array<() => void> = []
    refute.mockImplementation(
      () =>
        new Promise(resolve =>
          pending.push(() =>
            resolve({ refuted: false, reason: 'no', costUsd: 0.1 })
          )
        )
    )
    const run = runRewardHackLayer('scan2')
    for (let i = 0; i < 50 && pending.length < 3; i++)
      await new Promise(r => setImmediate(r))
    // All three started before any one finished.
    expect(pending).toHaveLength(3)
    pending.forEach(release => release())
    await run
    expect(refute).toHaveBeenCalledTimes(3)
    expect(
      refute.mock.calls.map(
        c => (c[0] as { item: { summary: string } }).item.summary
      )
    ).toEqual(['A', 'B', 'C'])
    // The two items past the cap were never checked: told, not dropped silently.
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_REFUTE_CAP'],
    })
    expect(stateWrites()[0]).toMatchObject({ refuteCapped: true })
  })

  it('exactly REWARD_HACK_MAX_REFUTES items: all refuted, no refute-cap cause', async () => {
    judge.mockResolvedValue({
      output: {
        suspicion: 90,
        items: ['A', 'B', 'C'].map(k => ({
          kind: 'OTHER',
          summary: k,
          eventIds: ['e2'],
        })),
      },
      costUsd: 0.5,
    })
    await runRewardHackLayer('scan2')
    expect(refute).toHaveBeenCalledTimes(3)
    expect(lastStage()).toEqual({ state: 'RAN', causes: [] })
    expect(stateWrites()[0]).not.toHaveProperty('refuteCapped')
  })

  it('a reused verdict that was refute-capped stays PARTIAL (REWARD_HACK_REFUTE_CAP)', async () => {
    previousScan = {
      id: 'scan1',
      rewardHackState: {
        version: REWARD_HACK_VERSION,
        watermark: { sess1: 'e2' },
        findingFingerprints: [],
        costUsd: 0.6,
        truncated: false,
        refuteCapped: true,
      },
    }
    await runRewardHackLayer('scan2')
    expect(judge).not.toHaveBeenCalled()
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_REFUTE_CAP'],
    })
    expect(stateWrites()[0]).toMatchObject({ refuteCapped: true })
  })

  it('LUM-1234 R21: a Write that only deleted tests from an existing test file is kept and refuted (not dropped by the diff gate)', async () => {
    const kept = [
      "describe('login', () => {",
      "  it('accepts a valid user', () => {",
      '    expect(login(validUser)).toBe(true)',
      '  })',
      '})',
    ].join('\n')
    const rewrite: Ev = {
      id: 'e2',
      sessionId: 'sess1',
      type: 'POST_TOOL_USE',
      toolName: 'Write',
      payload: {
        tool_name: 'Write',
        tool_input: { file_path: '/wt/src/auth.test.ts', content: kept },
        tool_response: { filePath: '/wt/src/auth.test.ts' },
      },
      createdAt: at('2026-10-09T10:00:00Z'),
    }
    db.hookEvent.findMany.mockResolvedValue([promptEv('e1', 'fix it'), rewrite])
    // The PR only removes lines: what the Write kept is context, not `+`.
    listFiles.mockResolvedValue([
      {
        filename: 'src/auth.test.ts',
        status: 'modified',
        patch: [
          '@@ -1,11 +1,5 @@',
          " describe('login', () => {",
          "   it('accepts a valid user', () => {",
          '     expect(login(validUser)).toBe(true)',
          '   })',
          "-  it('rejects a locked user', () => {",
          '-    expect(login(lockedUser)).toBe(false)',
          '-  })',
          "-  it('rejects a bad password', () => {",
          '-    expect(login(badPassword)).toBe(false)',
          '-  })',
          ' })',
        ].join('\n'),
      },
    ])
    await runRewardHackLayer('scan2')
    expect(refute).toHaveBeenCalledTimes(1)
    expect(writtenRows()).toHaveLength(1)
    expect(writtenRows()[0]).toMatchObject({ filePath: 'src/auth.test.ts' })
  })

  it('a token-dense input past RH_MAX_INPUT_TOKENS is PARTIAL (REWARD_HACK_INPUT_CAP) with no call, under the char cap', async () => {
    const events: Ev[] = [edit('e2', 'src/auth.test.ts')]
    for (let i = 0; i < 50; i++)
      events.push(
        promptEv(
          `p${String(i).padStart(3, '0')}`,
          '测'.repeat(4000),
          '2026-10-09T08:00:00Z'
        )
      )
    db.hookEvent.findMany.mockResolvedValue(events)
    await runRewardHackLayer('scan2')
    expect(judge).not.toHaveBeenCalled()
    expect(ledgerMicros).toBe(BigInt(0))
    expect(lastStage()).toEqual({
      state: 'PARTIAL',
      causes: ['REWARD_HACK_INPUT_CAP'],
    })
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
      version: 'rh-v1',
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
    // A state from before versions existed is never trusted for reuse.
    const { version: _v, ...legacy } = ok
    expect(parseRewardHackState(legacy)).toBeNull()
  })

  it('LUM-1234 R21: refuteCapped is optional, kept when true, refused when not a boolean', () => {
    const ok = {
      version: 'rh-v1',
      watermark: { s: 'e' },
      findingFingerprints: ['f'],
      costUsd: 0.2,
      truncated: false,
    }
    expect(parseRewardHackState({ ...ok, refuteCapped: true })).toEqual({
      ...ok,
      refuteCapped: true,
    })
    expect(parseRewardHackState({ ...ok, refuteCapped: false })).toEqual(ok)
    expect(parseRewardHackState({ ...ok, refuteCapped: 'yes' })).toBeNull()
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

describe('LUM-1234 stale reward-hack sweep', () => {
  it('stamps a reward-hack layer PENDING past 15 minutes FAILED by its run token and re-syncs', async () => {
    expect(REWARD_HACK_PENDING_DEAD_MS).toBe(15 * 60 * 1000)
    const now = new Date('2026-10-10T13:00:00Z')
    db.prSecurityScan.findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'scan2', startedAt: SCAN_STARTED }])
    const counts = await securityHuntOpsService.sweepStaleRewardHacks({ now })
    expect(db.prSecurityScan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          stages: { path: ['rewardHack'], equals: 'PENDING' },
          startedAt: { lt: new Date('2026-10-10T12:45:00Z') },
        },
      })
    )
    expect(counts).toEqual({ failed: 1 })
    expect(lastStage().state).toBe('FAILED')
    expect(sync).toHaveBeenCalledWith('scan2')
  })

  it('a verdict that landed first wins: nothing stamped, no sync', async () => {
    db.prSecurityScan.findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'scan2', startedAt: SCAN_STARTED }])
    db.prSecurityScan.findUnique.mockResolvedValue({
      ...SCAN,
      stages: { rewardHack: 'RAN' },
    })
    const counts = await securityHuntOpsService.sweepStaleRewardHacks({
      now: new Date('2026-10-10T13:00:00Z'),
    })
    expect(counts).toEqual({ failed: 0 })
    expect(db.prSecurityScan.update).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
  })
})
