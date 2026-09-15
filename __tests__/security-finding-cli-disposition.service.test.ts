/**
 * @jest-environment node
 *
 * LUM-750 — the finding CLI-disposition service over mocked repositories:
 * the receipt subject binds the finding's current state, the write appends a
 * SECURITY_FINDING_DISPOSITIONED activity stamped channel CLI with the
 * handshake times, the bulk write touches exactly the suggested rows (one
 * audit row each), and the rollback service reverts only CLI-channel rulings.
 */
import { activityRepository } from '@/lib/repositories/activity.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'
import {
  selfDispositionRollbackService,
  AGENT_ISSUED_REVERT_REASON,
} from '@/lib/services/self-disposition-rollback.service'
import { findingStateHash } from '@/lib/boundary-crossing/read-receipt'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listByTaskAndType: jest.fn(async () => []),
    listDispositionChangesByTask: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: jest.fn(async () => ({ id: 'actor-1' })),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findManyForSecurityByTaskId: jest.fn(async () => [
      { id: 'pr-1', number: 12 },
    ]),
  },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findFindingWithScope: jest.fn(),
    findLatestByPullRequestIds: jest.fn(async () => [
      {
        id: 'scan-1',
        pullRequestId: 'pr-1',
        startedAt: new Date('2026-09-14T00:00:00Z'),
      },
    ]),
    findSuggestedFalsePositivesByScanIds: jest.fn(async () => []),
    confirmSuggestedByScanIds: jest.fn(async () => 0),
    clearDisposition: jest.fn(async () => ({})),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findById: jest.fn(),
    disposition: jest.fn(async () => ({ count: 1 })),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findWithProjectWorkspaceId: jest.fn(),
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/pr-security-scan.service', () => ({
  prSecurityScanService: { disposition: jest.fn(), getForTask: jest.fn() },
}))

const findFinding = prSecurityScanRepository.findFindingWithScope as jest.Mock
const findSuggested =
  prSecurityScanRepository.findSuggestedFalsePositivesByScanIds as jest.Mock
const confirmSuggested =
  prSecurityScanRepository.confirmSuggestedByScanIds as jest.Mock
const clearDisposition = prSecurityScanRepository.clearDisposition as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const listActivities = activityRepository.listByTaskAndType as jest.Mock
const listCrossingChanges =
  activityRepository.listDispositionChangesByTask as jest.Mock
const findCrossing = boundaryCrossingRepository.findById as jest.Mock
const crossingDisposition = boundaryCrossingRepository.disposition as jest.Mock
const webDisposition = prSecurityScanService.disposition as jest.Mock

const FINDING = {
  id: 'f-1',
  scanId: 'scan-1',
  ruleId: 'ext:semgrep:sqli',
  severity: 'HIGH',
  provenance: 'EXTERNAL_TOOL',
  filePath: 'lib/q.ts',
  line: 40,
  fingerprint: 'fp-1',
  disposition: null,
  suggestedDisposition: 'FALSE_POSITIVE',
  scan: {
    pullRequestId: 'pr-1',
    pullRequest: { taskId: 't-1', workspaceId: 'w-1' },
  },
}
const CALLER = { sessionId: null, memberId: 'm-1' }
const ATTRIBUTION = {
  actorMemberId: 'm-1',
  sessionId: 'sess-9',
  handshake: {
    readAt: '2026-09-14T10:00:00.000Z',
    readAcknowledgedAt: '2026-09-14T10:01:00.000Z',
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.LUMO_RECEIPT_SECRET = 'test-secret'
  findFinding.mockResolvedValue(FINDING)
  webDisposition.mockResolvedValue({ id: 'f-1', disposition: 'FALSE_POSITIVE' })
  listActivities.mockResolvedValue([])
  listCrossingChanges.mockResolvedValue([])
  findSuggested.mockResolvedValue([])
})

describe('receipt subject (LUM-750)', () => {
  it('binds the finding state the task says is current — disposition, severity, provenance, fingerprint, ruleId, suggestion', async () => {
    const subject = await securityFindingCliDispositionService.receiptSubject(
      't-1',
      'f-1',
      'FALSE_POSITIVE',
      CALLER
    )
    expect(subject).toEqual({
      kind: 'finding',
      crossingId: 'f-1',
      taskId: 't-1',
      target: 'FALSE_POSITIVE',
      sessionId: null,
      memberId: 'm-1',
      stateHash: findingStateHash({
        disposition: null,
        severity: 'HIGH',
        provenance: 'EXTERNAL_TOOL',
        fingerprint: 'fp-1',
        ruleId: 'ext:semgrep:sqli',
        suggestedDisposition: 'FALSE_POSITIVE',
      }),
    })
  })

  it('a finding on another task is 404; no signing secret is 503 (fails closed)', async () => {
    findFinding.mockResolvedValue({
      ...FINDING,
      scan: {
        ...FINDING.scan,
        pullRequest: { taskId: 't-2', workspaceId: 'w-1' },
      },
    })
    await expect(
      securityFindingCliDispositionService.issueReadReceipt(
        't-1',
        'f-1',
        'FALSE_POSITIVE',
        CALLER
      )
    ).rejects.toMatchObject({ status: 404 })
    findFinding.mockResolvedValue(FINDING)
    delete process.env.LUMO_RECEIPT_SECRET
    delete process.env.CRON_SECRET
    await expect(
      securityFindingCliDispositionService.issueReadReceipt(
        't-1',
        'f-1',
        'FALSE_POSITIVE',
        CALLER
      )
    ).rejects.toMatchObject({ status: 503 })
  })

  it('the three stages round-trip through the service; a stage-1 receipt at the write is 409', async () => {
    const r1 = await securityFindingCliDispositionService.issueReadReceipt(
      't-1',
      'f-1',
      'FALSE_POSITIVE',
      CALLER
    )
    await expect(
      securityFindingCliDispositionService.verifyReadReceipt(
        't-1',
        'f-1',
        'FALSE_POSITIVE',
        r1.receipt,
        CALLER
      )
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('read not yet acknowledged'),
    })
    const r2 =
      await securityFindingCliDispositionService.acknowledgeReadReceipt(
        't-1',
        'f-1',
        'FALSE_POSITIVE',
        r1.receipt,
        CALLER
      )
    await expect(
      securityFindingCliDispositionService.verifyReadReceipt(
        't-1',
        'f-1',
        'FALSE_POSITIVE',
        r2.receipt,
        CALLER
      )
    ).resolves.toEqual({
      readAt: r2.readAt,
      readAcknowledgedAt: r2.readAcknowledgedAt,
    })
    // The finding changed in between (a web ruling landed): the receipt is void.
    findFinding.mockResolvedValue({ ...FINDING, disposition: 'ACCEPTED_RISK' })
    await expect(
      securityFindingCliDispositionService.verifyReadReceipt(
        't-1',
        'f-1',
        'FALSE_POSITIVE',
        r2.receipt,
        CALLER
      )
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('disposition write (LUM-750)', () => {
  it('writes through the scan service and appends a CLI-channel audit row with the handshake times', async () => {
    const view = await securityFindingCliDispositionService.disposition(
      't-1',
      'f-1',
      'FALSE_POSITIVE',
      'parsed id',
      ATTRIBUTION
    )
    expect(webDisposition).toHaveBeenCalledWith(
      't-1',
      'f-1',
      'FALSE_POSITIVE',
      'parsed id',
      'm-1'
    )
    expect(view).toMatchObject({ id: 'f-1', channel: 'CLI' })
    expect(createActivity).toHaveBeenCalledTimes(1)
    const call = createActivity.mock.calls[0][0]
    expect(call).toMatchObject({
      taskId: 't-1',
      actorId: 'actor-1',
      type: 'SECURITY_FINDING_DISPOSITIONED',
    })
    expect(call.payload).toMatchObject({
      findingId: 'f-1',
      from: null,
      to: 'FALSE_POSITIVE',
      note: 'parsed id',
      channel: 'CLI',
      sessionId: 'sess-9',
      readAt: ATTRIBUTION.handshake.readAt,
      readAcknowledgedAt: ATTRIBUTION.handshake.readAcknowledgedAt,
    })
    expect(typeof call.payload.confirmedAt).toBe('string')
  })

  it('an already-matching ruling writes no audit row', async () => {
    findFinding.mockResolvedValue({ ...FINDING, disposition: 'FALSE_POSITIVE' })
    await securityFindingCliDispositionService.disposition(
      't-1',
      'f-1',
      'FALSE_POSITIVE',
      null,
      ATTRIBUTION
    )
    expect(createActivity).not.toHaveBeenCalled()
  })
})

describe('bulk: every suggested false positive (LUM-750)', () => {
  const ROWS = [
    { ...FINDING, id: 'f-1', title: 'a', suggestedReason: 'r1' },
    {
      ...FINDING,
      id: 'f-3',
      title: 'b',
      fingerprint: 'fp-3',
      suggestedReason: null,
    },
  ]

  it('the receipt binds the suggested set on the latest scans and the response lists those rows', async () => {
    findSuggested.mockResolvedValue(ROWS)
    const r1 = await securityFindingCliDispositionService.issueBulkReadReceipt(
      't-1',
      CALLER
    )
    expect(findSuggested).toHaveBeenCalledWith(['scan-1'])
    expect(r1.findings.map(f => f.id)).toEqual(['f-1', 'f-3'])
    const r2 =
      await securityFindingCliDispositionService.acknowledgeBulkReadReceipt(
        't-1',
        r1.receipt,
        CALLER
      )
    await expect(
      securityFindingCliDispositionService.verifyBulkReadReceipt(
        't-1',
        r2.receipt,
        CALLER
      )
    ).resolves.toMatchObject({ readAt: r2.readAt })
    // A row leaving the set (dispositioned meanwhile) voids the receipt.
    findSuggested.mockResolvedValue([ROWS[0]])
    await expect(
      securityFindingCliDispositionService.verifyBulkReadReceipt(
        't-1',
        r2.receipt,
        CALLER
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('an empty suggested set is 422 — no receipt', async () => {
    await expect(
      securityFindingCliDispositionService.issueBulkReadReceipt('t-1', CALLER)
    ).rejects.toMatchObject({ status: 422 })
  })

  it('the write confirms only the suggested rows (the repository WHERE) and audits each one', async () => {
    findSuggested.mockResolvedValue(ROWS)
    confirmSuggested.mockResolvedValue(2)
    const out = await securityFindingCliDispositionService.dispositionSuggested(
      't-1',
      ATTRIBUTION
    )
    expect(confirmSuggested).toHaveBeenCalledWith(
      ['scan-1'],
      expect.objectContaining({ dispositionedById: 'm-1' })
    )
    expect(out).toEqual({
      confirmed: 2,
      findingIds: ['f-1', 'f-3'],
      channel: 'CLI',
    })
    expect(createActivity).toHaveBeenCalledTimes(2)
    for (const [, id] of [
      [0, 'f-1'],
      [1, 'f-3'],
    ] as const) {
      const payload = createActivity.mock.calls.find(
        c => c[0].payload.findingId === id
      )?.[0].payload
      expect(payload).toMatchObject({
        to: 'FALSE_POSITIVE',
        channel: 'CLI',
        bulk: true,
        sessionId: 'sess-9',
      })
    }
  })
})

describe('self-disposition rollback (LUM-750)', () => {
  const INPUT = {
    taskId: 't-1',
    selfDispositionCrossingId: 'sd-1',
    agentSessionId: 'sess-agent',
    hookEventId: 'evt-1',
  }

  it('reverts a CLI-channel crossing ruling to OPEN with an append-only trail; a web ruling is left alone', async () => {
    findCrossing.mockResolvedValue({
      id: 'cx-1',
      taskId: 't-1',
      category: 'HOOK_BYPASS',
      detail: 'git commit -n',
      disposition: 'FALSE_POSITIVE',
    })
    listCrossingChanges.mockResolvedValue([
      {
        payload: { boundaryCrossingId: 'cx-1', to: 'FALSE_POSITIVE' },
        actorId: 'a',
        createdAt: new Date(),
      },
      {
        payload: {
          boundaryCrossingId: 'cx-1',
          to: 'FALSE_POSITIVE',
          channel: 'CLI',
        },
        actorId: 'a',
        createdAt: new Date(),
      },
    ])
    const out = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [
        { kind: 'crossing', id: 'cx-1', taskIdentifier: null, bulk: false },
      ],
    })
    expect(out).toEqual({ crossings: ['cx-1'], findings: [], skipped: [] })
    expect(crossingDisposition).toHaveBeenCalledWith(
      'cx-1',
      null,
      null,
      null,
      expect.any(Date)
    )
    expect(createActivity.mock.calls[0][0]).toMatchObject({
      taskId: 't-1',
      actorId: null,
      type: 'BOUNDARY_CROSSING_DISPOSITIONED',
      payload: {
        boundaryCrossingId: 'cx-1',
        from: 'FALSE_POSITIVE',
        to: null,
        channel: 'SYSTEM',
        reason: AGENT_ISSUED_REVERT_REASON,
        selfDispositionCrossingId: 'sd-1',
        agentSessionId: 'sess-agent',
      },
    })
    // Latest ruling came from the web panel: untouched, reported as skipped.
    jest.clearAllMocks()
    listCrossingChanges.mockResolvedValue([
      {
        payload: {
          boundaryCrossingId: 'cx-1',
          to: 'FALSE_POSITIVE',
          channel: 'CLI',
        },
        actorId: 'a',
        createdAt: new Date(),
      },
      {
        payload: {
          boundaryCrossingId: 'cx-1',
          from: 'FALSE_POSITIVE',
          to: 'CONFIRMED',
        },
        actorId: 'a',
        createdAt: new Date(),
      },
    ])
    findCrossing.mockResolvedValue({
      id: 'cx-1',
      taskId: 't-1',
      category: 'HOOK_BYPASS',
      detail: 'x',
      disposition: 'CONFIRMED',
    })
    const out2 = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [
        { kind: 'crossing', id: 'cx-1', taskIdentifier: null, bulk: false },
      ],
    })
    expect(out2).toEqual({
      crossings: [],
      findings: [],
      skipped: ['crossing:cx-1'],
    })
    expect(crossingDisposition).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('an OPEN crossing (the command was refused / step 1 only) reverts nothing', async () => {
    findCrossing.mockResolvedValue({
      id: 'cx-1',
      taskId: 't-1',
      category: 'HOOK_BYPASS',
      detail: 'x',
      disposition: null,
    })
    const out = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [
        { kind: 'crossing', id: 'cx-1', taskIdentifier: null, bulk: false },
      ],
    })
    expect(out.skipped).toEqual(['crossing:cx-1'])
    expect(crossingDisposition).not.toHaveBeenCalled()
  })

  it('reverts a CLI-channel finding ruling (clears the row + SYSTEM audit row); a web ruling stays', async () => {
    findFinding.mockResolvedValue({ ...FINDING, disposition: 'FALSE_POSITIVE' })
    listActivities.mockResolvedValue([
      {
        payload: { findingId: 'f-1', to: 'FALSE_POSITIVE', channel: 'CLI' },
        createdAt: new Date(),
      },
    ])
    const out = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [{ kind: 'finding', id: 'f-1', taskIdentifier: null, bulk: false }],
    })
    expect(out).toEqual({ crossings: [], findings: ['f-1'], skipped: [] })
    expect(clearDisposition).toHaveBeenCalledWith('f-1')
    expect(createActivity.mock.calls[0][0]).toMatchObject({
      taskId: 't-1',
      type: 'SECURITY_FINDING_DISPOSITIONED',
      payload: {
        findingId: 'f-1',
        from: 'FALSE_POSITIVE',
        to: null,
        channel: 'SYSTEM',
        reason: AGENT_ISSUED_REVERT_REASON,
      },
    })
    jest.clearAllMocks()
    listActivities.mockResolvedValue([]) // web ruling: no CLI activity at all
    const out2 = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [{ kind: 'finding', id: 'f-1', taskIdentifier: null, bulk: false }],
    })
    expect(out2.skipped).toEqual(['finding:f-1'])
    expect(clearDisposition).not.toHaveBeenCalled()
  })

  it('the bulk form reverts every finding whose latest ruling is a CLI one still in force, resolving --task in the bound workspace', async () => {
    ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue(
      { project: { workspaceId: 'w-1' } }
    )
    ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
      id: 't-7',
    })
    listActivities.mockResolvedValue([
      {
        payload: {
          findingId: 'f-1',
          to: 'FALSE_POSITIVE',
          channel: 'CLI',
          bulk: true,
        },
        createdAt: new Date(),
      },
      {
        payload: {
          findingId: 'f-3',
          to: 'FALSE_POSITIVE',
          channel: 'CLI',
          bulk: true,
        },
        createdAt: new Date(),
      },
      {
        payload: {
          findingId: 'f-3',
          from: 'FALSE_POSITIVE',
          to: 'ACCEPTED_RISK',
        },
        createdAt: new Date(),
      }, // web correction
    ])
    findFinding.mockImplementation(async (id: string) => ({
      ...FINDING,
      id,
      disposition: id === 'f-3' ? 'ACCEPTED_RISK' : 'FALSE_POSITIVE',
      scan: {
        pullRequestId: 'pr-1',
        pullRequest: { taskId: 't-7', workspaceId: 'w-1' },
      },
    }))
    const out = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [
        { kind: 'finding', id: null, taskIdentifier: 'LUM-7', bulk: true },
      ],
    })
    expect(taskRepository.findByWorkspaceIdentifier).toHaveBeenCalledWith(
      'w-1',
      'LUM',
      7
    )
    expect(listActivities).toHaveBeenCalledWith(
      't-7',
      'SECURITY_FINDING_DISPOSITIONED'
    )
    expect(out).toEqual({ crossings: [], findings: ['f-1'], skipped: [] })
    expect(clearDisposition).toHaveBeenCalledTimes(1)
    expect(clearDisposition).toHaveBeenCalledWith('f-1')
  })

  it('a repository error on one ref is reported as skipped and never stops the others', async () => {
    findCrossing.mockRejectedValue(new Error('db down'))
    findFinding.mockResolvedValue({ ...FINDING, disposition: 'FALSE_POSITIVE' })
    listActivities.mockResolvedValue([
      {
        payload: { findingId: 'f-1', to: 'FALSE_POSITIVE', channel: 'CLI' },
        createdAt: new Date(),
      },
    ])
    const out = await selfDispositionRollbackService.rollback({
      ...INPUT,
      refs: [
        { kind: 'crossing', id: 'cx-1', taskIdentifier: null, bulk: false },
        { kind: 'finding', id: 'f-1', taskIdentifier: null, bulk: false },
      ],
    })
    expect(out).toEqual({
      crossings: [],
      findings: ['f-1'],
      skipped: ['crossing:cx-1 (error)'],
    })
  })
})
