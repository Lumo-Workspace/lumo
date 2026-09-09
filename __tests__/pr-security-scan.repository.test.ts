/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    prSecurityFinding: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import {
  prSecurityScanRepository,
  type NewFindingInput,
} from '@/lib/repositories/pr-security-scan.repository'

const mockTransaction = (prisma as unknown as { $transaction: jest.Mock })
  .$transaction
const mockScan = prisma.prSecurityScan as unknown as {
  findUnique: jest.Mock
  create: jest.Mock
  update: jest.Mock
  findMany: jest.Mock
  updateMany: jest.Mock
}
const mockFinding = prisma.prSecurityFinding as unknown as {
  createMany: jest.Mock
  deleteMany: jest.Mock
  findMany: jest.Mock
  findUnique: jest.Mock
  update: jest.Mock
  count: jest.Mock
}

const txClient = { prSecurityScan: mockScan, prSecurityFinding: mockFinding }
type TxCallback = (tx: typeof txClient) => unknown
mockTransaction.mockImplementation(async (arg: unknown) =>
  typeof arg === 'function'
    ? (arg as TxCallback)(txClient)
    : Promise.all(arg as Promise<unknown>[])
)

beforeEach(() => {
  jest.clearAllMocks()
  // LUM-735 C2: persistResult re-counts EXTERNAL_TOOL rows inside its
  // transaction; default to "none" so the existing cases keep their status.
  mockFinding.count.mockResolvedValue(0)
})

test('findByPrAndSha keys on the compound unique and create starts RUNNING', async () => {
  mockScan.findUnique.mockResolvedValue(null)
  // startedAt comes back too: the service needs it to spot a scan wedged in
  // RUNNING past the stale window (LUM-732 review I6).
  expect(await prSecurityScanRepository.findByPrAndSha('pr1', 'abc')).toBeNull()
  expect(mockScan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        pullRequestId_headSha: { pullRequestId: 'pr1', headSha: 'abc' },
      },
    })
  )
  mockScan.create.mockResolvedValue({ id: 's1' })
  await prSecurityScanRepository.create({
    pullRequestId: 'pr1',
    taskId: 't1',
    workspaceId: 'w1',
    headSha: 'abc',
    trigger: 'PR_EVENT',
    detectorVersion: 'secrets@1;judge@1',
  })
  expect(mockScan.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'RUNNING' }),
    })
  )
})

test('restart clears old findings and resets the scan; finalize stamps finishedAt', async () => {
  mockScan.findUnique.mockResolvedValueOnce({ stages: null })
  await prSecurityScanRepository.restart('s1')
  // LUM-735: the read -> deleteMany -> update sequence must be one atomic
  // transaction, not three round trips a crash could interleave.
  expect(mockTransaction).toHaveBeenCalledTimes(1)
  expect(mockFinding.deleteMany).toHaveBeenCalledWith({
    where: { scanId: 's1', provenance: { not: 'EXTERNAL_TOOL' } },
  })
  expect(mockScan.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 's1' },
      data: expect.objectContaining({
        status: 'RUNNING',
        error: null,
        finishedAt: null,
        stages: Prisma.DbNull,
        partial: false,
      }),
    })
  )
  await prSecurityScanRepository.finalize('s1', {
    status: 'CLEAN',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
    partial: false,
  })
  expect(mockScan.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: 'CLEAN',
        stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
        partial: false,
        finishedAt: expect.any(Date),
      }),
    })
  )
})

test('findScanRow selects and returns partial alongside stages', async () => {
  const startedAt = new Date('2026-09-03T10:00:00Z')
  mockScan.findUnique.mockResolvedValueOnce({
    id: 's1',
    status: 'RUNNING',
    stages: { secrets: 'RAN' },
    partial: true,
    startedAt,
  })
  const row = await prSecurityScanRepository.findScanRow('s1')
  expect(row).toEqual({
    id: 's1',
    status: 'RUNNING',
    stages: { secrets: 'RAN' },
    partial: true,
    startedAt,
  })
  expect(mockScan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      select: {
        id: true,
        status: true,
        stages: true,
        partial: true,
        startedAt: true,
      },
    })
  )
})

test('findDispositionedByPullRequest only returns dispositioned findings on that PR', async () => {
  mockFinding.findMany.mockResolvedValue([])
  await prSecurityScanRepository.findDispositionedByPullRequest('pr1')
  expect(mockFinding.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { scan: { pullRequestId: 'pr1' }, disposition: { not: null } },
    })
  )
})

test('findByPrAndSha selects startedAt so the service can age a RUNNING scan out', async () => {
  const startedAt = new Date('2026-09-03T10:00:00Z')
  mockScan.findUnique.mockResolvedValue({
    id: 's1',
    status: 'RUNNING',
    startedAt,
  })
  const row = await prSecurityScanRepository.findByPrAndSha('pr1', 'abc')
  expect(row).toEqual({ id: 's1', status: 'RUNNING', startedAt })
  expect(mockScan.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      select: { id: true, status: true, startedAt: true },
    })
  )
})

test('findLatestByPullRequestIds is bounded to one row per PR by distinct', async () => {
  // LUM-732 review I5: without `distinct` this read every scan ever made for
  // every linked PR — unbounded growth on a long-lived PR, with the findings
  // of each historical scan hydrated alongside.
  mockScan.findMany.mockResolvedValue([])
  expect(await prSecurityScanRepository.findLatestByPullRequestIds([])).toEqual(
    []
  )
  expect(mockScan.findMany).not.toHaveBeenCalled()

  await prSecurityScanRepository.findLatestByPullRequestIds(['pr1', 'pr2'])
  expect(mockScan.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { pullRequestId: { in: ['pr1', 'pr2'] } },
      orderBy: { startedAt: 'desc' },
      distinct: ['pullRequestId'],
    })
  )
})

test('persistResult writes findings and the finalize update in one transaction', async () => {
  // Spec §6.1: a scan that stamps FINDINGS but loses its rows (or the reverse)
  // is a lying panel. Both writes go through $transaction.
  const finding = {
    scanId: 's1',
    kind: 'SECRET' as const,
    ruleId: 'secret:aws-access-key-id',
    severity: 'HIGH' as const,
    provenance: 'DETERMINISTIC' as const,
    filePath: 'src/cfg.ts',
    line: 3,
    title: 't',
    detail: 'd',
    evidence: 'e',
    fingerprint: 'fp',
  }
  mockScan.findUnique.mockResolvedValueOnce({ stages: null })
  await prSecurityScanRepository.persistResult('s1', [finding], {
    status: 'FINDINGS',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: true,
  })
  expect(mockTransaction).toHaveBeenCalledTimes(1)
  expect(mockFinding.createMany).toHaveBeenCalledWith({ data: [finding] })
  expect(mockScan.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 's1' },
      data: expect.objectContaining({
        status: 'FINDINGS',
        judgeStatus: 'RAN',
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        partial: true,
        finishedAt: expect.any(Date),
      }),
    })
  )
})

test('persistResult with no findings still finalizes, in a one-op transaction', async () => {
  mockScan.findUnique.mockResolvedValueOnce({ stages: null })
  await prSecurityScanRepository.persistResult('s1', [], {
    status: 'CLEAN',
    judgeStatus: 'UNAVAILABLE',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'FAILED' },
    partial: false,
  })
  expect(mockFinding.createMany).not.toHaveBeenCalled()
  expect(mockTransaction).toHaveBeenCalledTimes(1)
})

test('persistResult never clears a partial already set by the other writer', async () => {
  // LUM-735: `partial` means "some layer hit a cap" and must be monotone —
  // once true it stays true regardless of what this writer's own outcome was.
  mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: true })
  await prSecurityScanRepository.persistResult('s1', [], {
    status: 'CLEAN',
    judgeStatus: 'RAN',
    truncated: false,
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
  })
  expect(mockScan.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ partial: true }),
    })
  )
})

describe('LUM-735 SARIF push — shared scan row', () => {
  test('createIfAbsent returns created:false on a unique violation and re-reads the winner', async () => {
    mockScan.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' })
    )
    mockScan.findUnique.mockResolvedValueOnce({
      id: 's1',
      status: 'RUNNING',
      startedAt: new Date(),
    })
    const out = await prSecurityScanRepository.createIfAbsent({
      pullRequestId: 'pr1',
      taskId: null,
      workspaceId: 'w1',
      headSha: 'abc',
      trigger: 'SARIF_PUSH',
      detectorVersion: 'x',
      status: 'PENDING',
    })
    expect(out).toMatchObject({ id: 's1', created: false, status: 'RUNNING' })
  })

  test('claimPending flips PENDING to RUNNING without touching findings', async () => {
    await prSecurityScanRepository.claimPending('s1')
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'RUNNING' }),
      })
    )
    expect(mockFinding.deleteMany).not.toHaveBeenCalled()
  })

  test('restart keeps EXTERNAL_TOOL findings and the ingest-owned external stage', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    })
    await prSecurityScanRepository.restart('s1')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: { scanId: 's1', provenance: { not: 'EXTERNAL_TOOL' } },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RUNNING',
          stages: { external: 'RAN' },
        }),
      })
    )
  })

  const extRow = (over: Partial<NewFindingInput> = {}): NewFindingInput => ({
    scanId: 's1',
    kind: 'VULNERABILITY',
    ruleId: 'ext:semgrep:a',
    severity: 'HIGH',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'a',
    line: 1,
    title: 't',
    detail: 'd',
    evidence: '',
    fingerprint: 'f1',
    ...over,
  })

  test('ingestExternalFindings deletes only that tool’s rows, then inserts, in one transaction', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: { secrets: 'RAN' },
      partial: false,
    })
    mockFinding.createMany.mockResolvedValueOnce({ count: 2 })
    const rows = [
      extRow(),
      extRow({ ruleId: 'ext:semgrep:b', severity: 'LOW', fingerprint: 'f2' }),
    ]
    const out = await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      rows,
      { partial: false }
    )
    expect(out).toEqual({ written: 2, flippedToFindings: false })
    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: {
        scanId: 's1',
        provenance: 'EXTERNAL_TOOL',
        OR: [{ ruleId: { startsWith: 'ext:semgrep:' } }],
      },
    })
    expect(mockFinding.createMany).toHaveBeenCalledWith({ data: rows })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: { stages: { secrets: 'RAN', external: 'RAN' }, partial: false },
      })
    )
  })

  test('ingestExternalFindings takes the scan-row lock BEFORE touching findings', async () => {
    // LUM-735 review C1: two completion paths (onUploadCompleted + /complete)
    // dispatch the same job milliseconds apart, so two ingests run at once.
    // The scan-row UPDATE is the serialization primitive — it must be the
    // FIRST write in the transaction, so the second ingest blocks on the row
    // lock until the first commits instead of interleaving its delete with
    // the first one's insert (which drops the winner's rows).
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: null,
      partial: false,
    })
    mockFinding.createMany.mockResolvedValueOnce({ count: 1 })
    await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      [extRow()],
      { partial: false }
    )
    const updateAt = mockScan.update.mock.invocationCallOrder[0]!
    const deleteAt = mockFinding.deleteMany.mock.invocationCallOrder[0]!
    const createAt = mockFinding.createMany.mock.invocationCallOrder[0]!
    expect(updateAt).toBeLessThan(deleteAt)
    expect(deleteAt).toBeLessThan(createAt)
  })

  test("ingestExternalFindings deletes every run's tool prefix and dedupes the list", async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: null,
      partial: false,
    })
    mockFinding.createMany.mockResolvedValueOnce({ count: 1 })
    const out = await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep-oss', 'gitleaks', 'semgrep-oss'],
      [extRow({ ruleId: 'ext:gitleaks:c', fingerprint: 'f3' })],
      { partial: false }
    )
    expect(out.written).toBe(1)
    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: {
        scanId: 's1',
        provenance: 'EXTERNAL_TOOL',
        OR: [
          { ruleId: { startsWith: 'ext:semgrep-oss:' } },
          { ruleId: { startsWith: 'ext:gitleaks:' } },
        ],
      },
    })
  })

  test('ingestExternalFindings flips a finalized CLEAN scan to FINDINGS when rows land', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'CLEAN',
      stages: { secrets: 'RAN' },
      partial: false,
    })
    mockFinding.createMany.mockResolvedValueOnce({ count: 1 })
    const out = await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      [extRow()],
      { partial: false }
    )
    expect(out).toEqual({ written: 1, flippedToFindings: true })
    expect(mockScan.update).toHaveBeenLastCalledWith({
      where: { id: 's1' },
      data: { status: 'FINDINGS' },
    })
  })

  test('ingestExternalFindings leaves a CLEAN scan CLEAN when the push brings no rows', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'CLEAN',
      stages: null,
      partial: false,
    })
    const out = await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      [],
      { partial: false }
    )
    expect(out).toEqual({ written: 0, flippedToFindings: false })
    expect(mockFinding.createMany).not.toHaveBeenCalled()
    expect(mockScan.update).toHaveBeenCalledTimes(1)
  })

  test('ingestExternalFindings ORs partial and can never clear the other writer’s true', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: null,
      partial: true,
    })
    await prSecurityScanRepository.ingestExternalFindings('s1', [], [], {
      partial: false,
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partial: true }),
      })
    )
    // An empty tool list is a caller bug — it must delete nothing.
    expect(mockFinding.deleteMany).not.toHaveBeenCalled()

    mockScan.update.mockClear()
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: null,
      partial: false,
    })
    await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      [],
      { partial: true }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partial: true }),
      })
    )
  })

  test('mergeStages read-modify-writes the JSON and can flip a finalized CLEAN to FINDINGS', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'CLEAN',
      partial: false,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'RAN' },
      { partial: true, status: 'FINDINGS' }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: {
          stages: { secrets: 'RAN', external: 'RAN' },
          partial: true,
          status: 'FINDINGS',
        },
      })
    )
  })

  test('persistResult never overwrites an ingest-owned external stage', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: { external: 'RAN' } })
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      partial: false,
      stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
        }),
      })
    )
  })

  test('finalize preserves an ingest-owned external stage and OR-merges partial', async () => {
    // LUM-735 review: persistResult already protects an ingest-owned
    // `stages.external` and monotonically ORs `partial`; finalize (the FAILED
    // path) must apply the same rule instead of blindly overwriting with
    // whatever stage A collected before it crashed.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'RAN' },
      partial: true,
    })
    await prSecurityScanRepository.finalize('s1', {
      status: 'FAILED',
      judgeStatus: null,
      truncated: false,
      stages: { secrets: 'RAN', external: 'NOT_CONFIGURED' },
      partial: false,
      error: 'boom',
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          stages: { secrets: 'RAN', external: 'RAN' },
          partial: true,
          status: 'FAILED',
        }),
      })
    )
  })

  test('mergeStages cannot clear a partial already set by the other writer', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'FINDINGS',
      partial: true,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'RAN' },
      { partial: false }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partial: true }),
      })
    )
  })

  test('mergeStages sets partial true when this writer is the first to hit a cap', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'CLEAN',
      partial: false,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'RAN' },
      { partial: true }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ partial: true }),
      })
    )
  })

  test('persistResult re-counts EXTERNAL_TOOL rows and refuses to write CLEAN over them', async () => {
    // LUM-735 review C2: stage A decided CLEAN from a count taken BEFORE the
    // judge ran (seconds earlier, outside this transaction). If an ingest
    // committed in that window, the row it read is stale — inside the
    // transaction, holding the row lock, the count is authoritative.
    mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: false })
    mockFinding.count.mockResolvedValueOnce(2)
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
      partial: false,
    })
    expect(mockFinding.count).toHaveBeenCalledWith({
      where: { scanId: 's1', provenance: 'EXTERNAL_TOOL' },
    })
    expect(mockScan.update).toHaveBeenLastCalledWith({
      where: { id: 's1' },
      data: { status: 'FINDINGS' },
    })
  })

  test('persistResult leaves CLEAN alone when no EXTERNAL_TOOL rows exist', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: false })
    mockFinding.count.mockResolvedValueOnce(0)
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN', external: 'NOT_CONFIGURED', judge: 'RAN' },
      partial: false,
    })
    expect(mockScan.update).toHaveBeenCalledTimes(1)
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CLEAN' }),
      })
    )
  })

  test('persistResult takes the scan-row lock before writing findings', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: false })
    await prSecurityScanRepository.persistResult(
      's1',
      [
        {
          scanId: 's1',
          kind: 'SECRET',
          ruleId: 'secret:x',
          severity: 'HIGH',
          provenance: 'DETERMINISTIC',
          filePath: 'a',
          line: 1,
          title: 't',
          detail: 'd',
          evidence: 'e',
          fingerprint: 'fp',
        },
      ],
      {
        status: 'FINDINGS',
        judgeStatus: 'RAN',
        truncated: false,
        stages: { secrets: 'RAN' },
        partial: false,
      }
    )
    expect(mockScan.update.mock.invocationCallOrder[0]!).toBeLessThan(
      mockFinding.createMany.mock.invocationCallOrder[0]!
    )
  })

  test('countExternalFindings counts EXTERNAL_TOOL rows of the scan', async () => {
    mockFinding.count.mockResolvedValueOnce(3)
    expect(await prSecurityScanRepository.countExternalFindings('s1')).toBe(3)
    expect(mockFinding.count).toHaveBeenCalledWith({
      where: { scanId: 's1', provenance: 'EXTERNAL_TOOL' },
    })
  })
})

// ── LUM-737: one-shot PreToolUse reminder support ────────────────────────────

test('findUnnotifiedFindingScansByTask reads only FINDINGS scans on the task that have not been reminded', async () => {
  mockScan.findMany.mockResolvedValue([
    { id: 's1', pullRequestId: 'pr1', headSha: 'abc' },
  ])
  const rows =
    await prSecurityScanRepository.findUnnotifiedFindingScansByTask('t1')
  expect(rows).toEqual([{ id: 's1', pullRequestId: 'pr1', headSha: 'abc' }])
  expect(mockScan.findMany).toHaveBeenCalledWith({
    where: { taskId: 't1', status: 'FINDINGS', agentNotifiedAt: null },
    select: { id: true, pullRequestId: true, headSha: true },
    orderBy: { startedAt: 'asc' },
  })
})

test('markAgentNotified stamps only un-notified rows (idempotent) and skips the write for an empty list', async () => {
  mockScan.updateMany.mockResolvedValue({ count: 2 })
  const now = new Date('2026-09-09T00:00:00Z')
  expect(
    await prSecurityScanRepository.markAgentNotified(['s1', 's2'], now)
  ).toBe(2)
  expect(mockScan.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['s1', 's2'] }, agentNotifiedAt: null },
    data: { agentNotifiedAt: now },
  })
  mockScan.updateMany.mockClear()
  expect(await prSecurityScanRepository.markAgentNotified([], now)).toBe(0)
  expect(mockScan.updateMany).not.toHaveBeenCalled()
})
