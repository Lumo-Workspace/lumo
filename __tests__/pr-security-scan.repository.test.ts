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
      count: jest.fn(),
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
  count: jest.Mock
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
// LUM-735 review: the writers of the shared scan row now pass transaction
// options (Serializable + timeout) as a second argument.
mockTransaction.mockImplementation(async (arg: unknown, _opts?: unknown) =>
  typeof arg === 'function'
    ? (arg as TxCallback)(txClient)
    : Promise.all(arg as Promise<unknown>[])
)

const SERIALIZABLE = { isolationLevel: 'Serializable', timeout: 15000 }
const conflict = () => Object.assign(new Error('conflict'), { code: 'P2034' })

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

test('findDispositionedByPullRequest only returns dispositioned findings on that PR', async () => {
  mockFinding.findMany.mockResolvedValue([])
  await prSecurityScanRepository.findDispositionedByPullRequest('pr1')
  expect(mockFinding.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      // LUM-740: an open LLM suggestion is inherited too, so a re-ingest
      // neither re-judges it nor loses the human's outcome.
      where: {
        scan: { pullRequestId: 'pr1' },
        OR: [
          { disposition: { not: null } },
          { suggestedDisposition: { not: null } },
        ],
      },
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

  test('mergeStages writes the external-failure reason into data.error', async () => {
    // LUM-735 Task 1 — the ingest path's only write of `error`.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'PENDING',
      partial: false,
    })
    await prSecurityScanRepository.mergeStages(
      's1',
      { external: 'FAILED' },
      { error: 'external: x' }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: 'external: x' }),
      })
    )
  })

  test('mergeStages omits error from data when the extra reason is not provided', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', external: 'PENDING' },
      status: 'PENDING',
      partial: false,
    })
    await prSecurityScanRepository.mergeStages('s1', { external: 'FAILED' })
    const call =
      mockScan.update.mock.calls[mockScan.update.mock.calls.length - 1][0]
    expect(call.data.error).toBeUndefined()
    expect('error' in call.data).toBe(false)
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

  test('the shared row’s writers run at Serializable isolation', async () => {
    // LUM-735 review: the findUnique that feeds the merge runs BEFORE the
    // locking update, so at READ COMMITTED a writer committing in that window
    // is merged from a stale snapshot (an ingest misses stage A's CLEAN flip;
    // stage A reverts stages.external from RAN to PENDING; partial is
    // cleared). Serializable isolation makes that interleaving abort instead.
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: null,
      partial: false,
    })
    await prSecurityScanRepository.ingestExternalFindings('s1', [], [], {
      partial: false,
    })
    expect(mockTransaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      SERIALIZABLE
    )

    mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: false })
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      stages: { secrets: 'RAN' },
      partial: false,
    })
    expect(mockTransaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      SERIALIZABLE
    )
  })

  test('a P2034 serialization failure is retried, re-reading the row', async () => {
    mockScan.findUnique
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({
        status: 'RUNNING',
        stages: null,
        partial: false,
      })
    mockFinding.createMany.mockResolvedValueOnce({ count: 1 })
    const out = await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      [extRow()],
      { partial: false }
    )
    expect(out).toEqual({ written: 1, flippedToFindings: false })
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  test('a P2034 that never settles is rethrown after the last attempt', async () => {
    mockScan.findUnique
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
    await expect(
      prSecurityScanRepository.persistResult('s1', [], {
        status: 'CLEAN',
        judgeStatus: 'RAN',
        truncated: false,
        stages: { secrets: 'RAN' },
        partial: false,
      })
    ).rejects.toThrow('conflict')
    expect(mockTransaction).toHaveBeenCalledTimes(3)
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

// ── LUM-738: supply-chain stage ownership + persisting rows ─────────────────

describe('LUM-738 supplyChain surface — repository', () => {
  const depRow = (over: Partial<NewFindingInput> = {}): NewFindingInput => ({
    scanId: 's1',
    kind: 'DEPENDENCY',
    ruleId: 'ext:osv-scanner:GHSA-1',
    severity: 'HIGH',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'package-lock.json',
    line: null,
    title: 'GHSA-1',
    detail: 'lodash@1 is vulnerable to GHSA-1',
    evidence: '',
    fingerprint: 'dep-1',
    externalRef: 'https://osv.dev/vulnerability/GHSA-1',
    disposition: null,
    persisting: true,
    ...over,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockTransaction.mockImplementation(async (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as TxCallback)(txClient)
        : Promise.all(arg as Promise<unknown>[])
    )
  })

  test('ingestExternalFindings stamps the requested stage RAN (supplyChain) and leaves external alone', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: { secrets: 'RAN', external: 'PENDING', supplyChain: 'PENDING' },
      partial: false,
    })
    mockFinding.createMany.mockResolvedValueOnce({ count: 1 })
    const rows = [depRow()]
    await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['osv-scanner'],
      rows,
      { partial: false, stage: 'supplyChain' }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          stages: {
            secrets: 'RAN',
            external: 'PENDING',
            supplyChain: 'RAN',
          },
          partial: false,
        },
      })
    )
    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: {
        scanId: 's1',
        provenance: 'EXTERNAL_TOOL',
        OR: [{ ruleId: { startsWith: 'ext:osv-scanner:' } }],
      },
    })
    // The persisting flag rides along into the row as-is.
    expect(mockFinding.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ persisting: true })],
    })
  })

  test('ingestExternalFindings defaults to the external stage', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      status: 'RUNNING',
      stages: { secrets: 'RAN' },
      partial: false,
    })
    mockFinding.createMany.mockResolvedValueOnce({ count: 0 })
    await prSecurityScanRepository.ingestExternalFindings(
      's1',
      ['semgrep'],
      [],
      {
        partial: false,
      }
    )
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stages: { secrets: 'RAN', external: 'RAN' }, partial: false },
      })
    )
  })

  test.each(['RAN', 'FAILED', 'SKIPPED'] as const)(
    'persistResult and finalize preserve an ingest-owned supplyChain=%s over stage A’s PENDING',
    async owned => {
      mockScan.findUnique.mockResolvedValue({
        stages: { external: 'RAN', supplyChain: owned },
        partial: false,
      })
      await prSecurityScanRepository.persistResult('s1', [], {
        status: 'CLEAN',
        judgeStatus: 'RAN',
        truncated: false,
        partial: false,
        stages: {
          secrets: 'RAN',
          external: 'PENDING',
          supplyChain: 'PENDING',
          judge: 'RAN',
        },
      })
      expect(mockScan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stages: {
              secrets: 'RAN',
              external: 'RAN',
              supplyChain: owned,
              judge: 'RAN',
            },
          }),
        })
      )
      mockScan.update.mockClear()
      await prSecurityScanRepository.finalize('s1', {
        status: 'FAILED',
        judgeStatus: null,
        truncated: false,
        stages: { secrets: 'RAN', supplyChain: 'PENDING' },
        partial: false,
        error: 'boom',
      })
      expect(mockScan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stages: { secrets: 'RAN', external: 'RAN', supplyChain: owned },
          }),
        })
      )
    }
  )

  test('a PENDING supplyChain the ingest never resolved is NOT owned — stage A’s value wins', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { supplyChain: 'PENDING' },
      partial: false,
    })
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      partial: false,
      stages: { secrets: 'RAN', supplyChain: 'NOT_CONFIGURED' },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: { secrets: 'RAN', supplyChain: 'NOT_CONFIGURED' },
        }),
      })
    )
  })

  test('findByIdForReview loads persisting so the PR write-back can tell new from already-on-main', async () => {
    mockScan.findUnique.mockResolvedValueOnce(null)
    await prSecurityScanRepository.findByIdForReview('s1')
    expect(mockScan.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          findings: expect.objectContaining({
            select: expect.objectContaining({ persisting: true }),
          }),
        }),
      })
    )
  })
})

describe('LUM-745 managed-run ops queries', () => {
  test('setManagedRunId writes the run id AND stamps external/supplyChain PENDING in one serializable write', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: null })
    await prSecurityScanRepository.setManagedRunId('s1', 'run_1')
    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      SERIALIZABLE
    )
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        managedRunId: 'run_1',
        stages: { external: 'PENDING', supplyChain: 'PENDING' },
      },
    })
  })

  test('setManagedRunId never downgrades an external layer another writer settled', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: {
        secrets: 'RAN',
        external: 'SUPERSEDED',
        supplyChain: 'SUPERSEDED',
      },
    })
    await prSecurityScanRepository.setManagedRunId('s1', 'run_1')
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        managedRunId: 'run_1',
        stages: {
          secrets: 'RAN',
          external: 'SUPERSEDED',
          supplyChain: 'SUPERSEDED',
        },
      },
    })
  })

  test('findStagesById returns {} for a null column and null for a missing row', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: null })
    expect(await prSecurityScanRepository.findStagesById('s1')).toEqual({})
    mockScan.findUnique.mockResolvedValueOnce(null)
    expect(await prSecurityScanRepository.findStagesById('s1')).toBeNull()
    expect(mockScan.findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      select: { stages: true },
    })
  })

  test('findPendingManagedByPullRequest excludes the new row and keys on external=PENDING with a run id', async () => {
    mockScan.findMany.mockResolvedValueOnce([
      {
        id: 'old',
        headSha: 'b'.repeat(40),
        managedRunId: 'run_old',
        stages: { external: 'PENDING', supplyChain: 'PENDING' },
      },
    ])
    const rows = await prSecurityScanRepository.findPendingManagedByPullRequest(
      'pr1',
      'new'
    )
    expect(rows).toEqual([
      expect.objectContaining({ id: 'old', managedRunId: 'run_old' }),
    ])
    expect(mockScan.findMany).toHaveBeenCalledWith({
      where: {
        pullRequestId: 'pr1',
        id: { not: 'new' },
        managedRunId: { not: null },
        stages: { path: ['external'], equals: 'PENDING' },
      },
      select: { id: true, headSha: true, managedRunId: true, stages: true },
    })
  })

  test('findStalePendingExternal takes the oldest PENDING rows started before the cutoff', async () => {
    const before = new Date('2026-09-10T10:00:00Z')
    mockScan.findMany.mockResolvedValueOnce([])
    await prSecurityScanRepository.findStalePendingExternal(before, 50)
    expect(mockScan.findMany).toHaveBeenCalledWith({
      where: {
        startedAt: { lt: before },
        stages: { path: ['external'], equals: 'PENDING' },
      },
      orderBy: { startedAt: 'asc' },
      take: 50,
      select: { id: true, managedRunId: true, stages: true },
    })
  })

  test('countManagedRunsSince counts rows with a run id started since the cutoff', async () => {
    const since = new Date('2026-09-10T09:00:00Z')
    mockScan.count.mockResolvedValueOnce(7)
    expect(
      await prSecurityScanRepository.countManagedRunsSince('w1', since)
    ).toBe(7)
    expect(mockScan.count).toHaveBeenCalledWith({
      where: {
        workspaceId: 'w1',
        managedRunId: { not: null },
        startedAt: { gte: since },
      },
    })
  })

  test('persistResult and finalize keep a SUPERSEDED external/supplyChain stamped by supersede', async () => {
    // A late-finalizing stage A (the old head's own run) must not flip the
    // row back to PENDING after a newer head superseded it.
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'SUPERSEDED', supplyChain: 'SUPERSEDED' },
      partial: false,
    })
    await prSecurityScanRepository.persistResult('old', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      partial: false,
      stages: {
        secrets: 'RAN',
        external: 'PENDING',
        supplyChain: 'PENDING',
        judge: 'RAN',
      },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: {
            secrets: 'RAN',
            external: 'SUPERSEDED',
            supplyChain: 'SUPERSEDED',
            judge: 'RAN',
          },
        }),
      })
    )
    mockScan.update.mockClear()
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'SUPERSEDED' },
      partial: false,
    })
    await prSecurityScanRepository.finalize('old', {
      status: 'FAILED',
      judgeStatus: null,
      truncated: false,
      stages: { secrets: 'RAN', external: 'PENDING' },
      partial: false,
      error: 'boom',
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: { secrets: 'RAN', external: 'SUPERSEDED' },
        }),
      })
    )
  })

  test('persistResult keeps the prefixed reason that came with a kept SUPERSEDED layer', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'SUPERSEDED' },
      partial: false,
      error: 'external: superseded by abc1234',
    })
    await prSecurityScanRepository.persistResult('old', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      partial: false,
      stages: { secrets: 'RAN', external: 'PENDING', judge: 'RAN' },
    })
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stages: { secrets: 'RAN', external: 'SUPERSEDED', judge: 'RAN' },
          error: 'external: superseded by abc1234',
        }),
      })
    )
  })

  test('persistResult still blanks an unprefixed error and finalize still prefers its own reason', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'FAILED' },
      partial: false,
      error: 'raw stage A crash text',
    })
    await prSecurityScanRepository.persistResult('s1', [], {
      status: 'CLEAN',
      judgeStatus: 'RAN',
      truncated: false,
      partial: false,
      stages: { secrets: 'RAN', external: 'PENDING' },
    })
    expect(mockScan.update.mock.calls[0][0].data.error).toBeNull()
    mockScan.update.mockClear()
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'SUPERSEDED' },
      partial: false,
      error: 'external: superseded by abc1234',
    })
    await prSecurityScanRepository.finalize('s1', {
      status: 'FAILED',
      judgeStatus: null,
      truncated: false,
      stages: { secrets: 'RAN', external: 'PENDING' },
      partial: false,
      error: 'boom',
    })
    expect(mockScan.update.mock.calls[0][0].data.error).toBe('boom')
  })

  test('restart does not carry a SUPERSEDED external layer into the re-run', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { external: 'SUPERSEDED' },
    })
    await prSecurityScanRepository.restart('s1')
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stages: Prisma.DbNull }),
      })
    )
    mockScan.update.mockClear()
    mockScan.findUnique.mockResolvedValueOnce({ stages: { external: 'RAN' } })
    await prSecurityScanRepository.restart('s1')
    expect(mockScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stages: { external: 'RAN' } }),
      })
    )
  })
})
