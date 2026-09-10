/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    prSecurityScan: { findUnique: jest.fn(), update: jest.fn() },
    prSecurityFinding: { createMany: jest.fn() },
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
  update: jest.Mock
}
const mockFinding = prisma.prSecurityFinding as unknown as {
  createMany: jest.Mock
}
const txClient = { prSecurityScan: mockScan, prSecurityFinding: mockFinding }
type TxCallback = (tx: typeof txClient) => unknown
mockTransaction.mockImplementation(async (arg: unknown, _opts?: unknown) =>
  (arg as TxCallback)(txClient)
)

const row: NewFindingInput = {
  scanId: 's1',
  kind: 'VULNERABILITY',
  ruleId: 'hunt:idor',
  severity: 'MEDIUM',
  provenance: 'LLM_JUDGE',
  filePath: 'lib/a.ts',
  line: 3,
  title: 't',
  detail: 'd',
  evidence: 'e',
  fingerprint: 'f'.repeat(16),
  externalRef: null,
  disposition: null,
  cwe: 'CWE-639',
  reachability: 'EXTERNAL',
  callChain: [{ from: 'a', to: 'b' }],
  falsifierVerdict: 'INCONCLUSIVE',
}

beforeEach(() => jest.clearAllMocks())

describe('LUM-739 repository', () => {
  test('persistHuntResult merges hunt into stages, keeps partial monotone, writes audit/tokens, flips to FINDINGS and inserts rows', async () => {
    const calls: string[] = []
    mockScan.findUnique.mockResolvedValueOnce({
      stages: {
        secrets: 'RAN',
        external: 'RAN',
        judge: 'RAN',
        hunt: 'PENDING',
      },
      partial: true,
    })
    mockScan.update.mockImplementation(async () => calls.push('update'))
    mockFinding.createMany.mockImplementation(async () =>
      calls.push('createMany')
    )
    await prSecurityScanRepository.persistHuntResult('s1', [row], {
      hunt: 'RAN',
      huntAudit: { candidates: 1 },
      tokenSpent: 1234,
      partial: false,
    })
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 15000,
    })
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN', hunt: 'RAN' },
        partial: true,
        huntAudit: { candidates: 1 },
        tokenSpent: 1234,
        status: 'FINDINGS',
      },
    })
    expect(mockFinding.createMany).toHaveBeenCalledWith({ data: [row] })
    expect(calls).toEqual(['update', 'createMany'])
  })

  test('a FAILED hunt writes no rows, changes no status, still records tokens and the audit error', async () => {
    mockScan.findUnique.mockResolvedValueOnce({
      stages: { secrets: 'RAN', hunt: 'PENDING' },
      partial: false,
    })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'FAILED',
      huntAudit: { error: 'boom' },
      tokenSpent: 20,
      partial: false,
    })
    expect(mockScan.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        stages: { secrets: 'RAN', hunt: 'FAILED' },
        partial: false,
        huntAudit: { error: 'boom' },
        tokenSpent: 20,
      },
    })
    expect(mockFinding.createMany).not.toHaveBeenCalled()
  })

  test('a PARTIAL hunt sets partial even when the row was not partial before', async () => {
    mockScan.findUnique.mockResolvedValueOnce({ stages: null, partial: false })
    await prSecurityScanRepository.persistHuntResult('s1', [], {
      hunt: 'PARTIAL',
      huntAudit: {},
      tokenSpent: null,
      partial: true,
    })
    expect(mockScan.update.mock.calls[0]?.[0].data).toMatchObject({
      stages: { hunt: 'PARTIAL' },
      partial: true,
      tokenSpent: null,
    })
  })
})
