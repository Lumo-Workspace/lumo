/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  readRepoFile: jest.fn(),
}))
jest.mock('@/lib/llm/security-hunt-client', () => ({ huntCategory: jest.fn() }))
jest.mock('@/lib/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findDispositionedByPullRequest: jest.fn(),
    persistHuntResult: jest.fn(),
  },
}))

import {
  securityHuntService,
  toHuntFindingRows,
} from '@/lib/services/security-hunt.service'
import { logger } from '@/lib/logger'
import { fetchPrDiff, readRepoFile } from '@/lib/integrations/github/contents'
import { huntCategory } from '@/lib/llm/security-hunt-client'
import { falsifyCandidate } from '@/lib/llm/security-falsifier-client'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { SUBGRAPH_MAX_FILES } from '@/lib/security-scan/graph/types'

const diffMock = fetchPrDiff as jest.Mock
const readMock = readRepoFile as jest.Mock
const huntMock = huntCategory as jest.Mock
const falsifyMock = falsifyCandidate as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>

const JOB = {
  scanId: 's1',
  pullRequestId: 'pr1',
  taskId: null,
  workspaceId: 'w1',
  repo: 'o/r',
  prNumber: 7,
  headSha: 'b'.repeat(40),
}

function diffFor(paths: string[]): string {
  return paths
    .map(
      p =>
        `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -0,0 +1 @@\n+export const x = 1\n`
    )
    .join('')
}

// Built at runtime so the fixture is not itself a secret-shaped literal.
const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('')

const candidate = {
  category: 'injection' as const,
  cwe: 'CWE-89',
  severity: 'HIGH' as const,
  sink: {
    symbol: 'lib/s.ts#prisma.$queryRawUnsafe@5',
    file: 'lib/s.ts',
    line: 5,
  },
  entry: {
    symbol: 'app/api/x/route.ts#POST',
    file: 'app/api/x/route.ts',
    line: 3,
  },
  call_chain: [
    { from: 'app/api/x/route.ts#POST', to: 'lib/s.ts#svc.run' },
    { from: 'lib/s.ts#svc.run', to: 'lib/s.ts#prisma.$queryRawUnsafe@5' },
  ],
  precondition: 'body.sql attacker controlled',
  claim: `raw sql from body — key ${FAKE_AWS_KEY} leaked`,
  reachability: 'EXTERNAL' as const,
  fingerprint: 'c'.repeat(16),
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.persistHuntResult.mockResolvedValue(undefined)
})

describe('LUM-739 hunt service', () => {
  it('buildSubgraph reads touched TS files and their one-hop imports at the head sha, skipping non-TS files', async () => {
    diffMock.mockResolvedValue(diffFor(['app/api/x/route.ts', 'docs/a.md']))
    readMock.mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'app/api/x/route.ts')
        return `import { svc } from '@/lib/s'\nimport { z } from 'zod'\nexport async function POST() { return svc.run() }\n`
      if (path === 'lib/s.ts')
        return `export const svc = { run() { return 1 } }\n`
      return null
    })
    const out = await securityHuntService.buildSubgraph(JOB)
    expect(out.partial).toBe(false)
    expect(out.subgraph.files).toEqual([
      { path: 'app/api/x/route.ts', lineCount: 3, touched: true },
      { path: 'lib/s.ts', lineCount: 1, touched: false },
    ])
    const reads = readMock.mock.calls.map(c => c[0])
    expect(
      reads.every(r => r.ref === JOB.headSha && r.fullName === 'o/r')
    ).toBe(true)
    expect(reads.map(r => r.path)).toEqual(['app/api/x/route.ts', 'lib/s.ts'])
    expect(out.subgraph.edges).toContainEqual({
      from: 'app/api/x/route.ts#POST',
      to: 'lib/s.ts#svc.run',
    })
  })

  it('buildSubgraph tries the next import candidate when the first does not exist', async () => {
    diffMock.mockResolvedValue(diffFor(['lib/a.ts']))
    readMock.mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'lib/a.ts')
        return `import { b } from './b'\nexport const a = () => b()\n`
      if (path === 'lib/b/index.ts') return `export const b = () => 1\n`
      return null
    })
    const out = await securityHuntService.buildSubgraph(JOB)
    expect(out.subgraph.files.map(f => f.path)).toEqual([
      'lib/a.ts',
      'lib/b/index.ts',
    ])
    expect(readMock.mock.calls.map(c => c[0].path)).toEqual([
      'lib/a.ts',
      'lib/b.ts',
      'lib/b.tsx',
      'lib/b/index.ts',
    ])
  })

  it('buildSubgraph caps at SUBGRAPH_MAX_FILES and marks partial', async () => {
    const paths = Array.from(
      { length: SUBGRAPH_MAX_FILES + 1 },
      (_, i) => `lib/f${String(i).padStart(2, '0')}.ts`
    )
    diffMock.mockResolvedValue(diffFor(paths))
    readMock.mockResolvedValue('export const x = 1\n')
    const out = await securityHuntService.buildSubgraph(JOB)
    expect(out.partial).toBe(true)
    expect(out.subgraph.files).toHaveLength(SUBGRAPH_MAX_FILES)
  })

  it('huntBatch returns the client result with elapsed time and memoises file reads', async () => {
    readMock.mockResolvedValue('src')
    huntMock.mockImplementation(
      async (input: { readFile: (p: string) => Promise<string | null> }) => {
        await input.readFile('a.ts')
        await input.readFile('a.ts')
        return { candidates: [{ raw: 1 }], tokens: 321, stopped: 'done' }
      }
    )
    const out = await securityHuntService.huntBatch({
      job: JOB,
      subgraph: {
        symbols: [],
        edges: [],
        files: [{ path: 'a.ts', lineCount: 1, touched: true }],
      },
      category: 'idor',
      tokenBudget: 1000,
      timeBudgetMs: 5000,
    })
    expect(out).toMatchObject({
      candidates: [{ raw: 1 }],
      tokens: 321,
      stopped: 'done',
    })
    expect(out.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(huntMock.mock.calls[0]![0]).toMatchObject({
      category: 'idor',
      tokenBudget: 1000,
      timeoutMs: 5000,
      maxSteps: 12,
    })
  })

  it('huntBatch never throws: a timeout is a "timeout" batch, anything else an "error" batch', async () => {
    const input = {
      job: JOB,
      subgraph: { symbols: [], edges: [], files: [] },
      category: 'ssrf' as const,
      tokenBudget: 1,
      timeBudgetMs: 1,
    }
    huntMock.mockRejectedValueOnce(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    )
    await expect(securityHuntService.huntBatch(input)).resolves.toMatchObject({
      candidates: [],
      tokens: 0,
      stopped: 'timeout',
      error: 'timed out',
    })
    huntMock.mockRejectedValueOnce(new Error('gateway 500'))
    await expect(securityHuntService.huntBatch(input)).resolves.toMatchObject({
      stopped: 'error',
      error: 'gateway 500',
    })
  })

  it('falsify hands numbered snippets around the entry and sink to the client and rethrows its failures', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join(
      '\n'
    )
    readMock.mockResolvedValue(lines)
    falsifyMock.mockResolvedValueOnce({
      verdict: 'REJECT',
      reason: 'guarded',
      tokens: 9,
    })
    await expect(
      securityHuntService.falsify({ job: JOB, candidate })
    ).resolves.toEqual({
      verdict: 'REJECT',
      reason: 'guarded',
      tokens: 9,
    })
    const arg = falsifyMock.mock.calls[0]![0]
    expect(arg.entrySnippet.startsWith('1: line1')).toBe(true)
    expect(arg.entrySnippet).toContain('28: line28')
    expect(arg.entrySnippet).not.toContain('29: line29')
    expect(arg.sinkSnippet).toContain('30: line30')
    expect(readMock.mock.calls.map(c => c[0].path)).toEqual([
      'app/api/x/route.ts',
      'lib/s.ts',
    ])
    falsifyMock.mockRejectedValueOnce(new Error('verifier down'))
    await expect(
      securityHuntService.falsify({ job: JOB, candidate })
    ).rejects.toThrow('verifier down')
  })

  it('toHuntFindingRows maps a finding to an advisory LLM_JUDGE row with every free-text field redacted', () => {
    const [row] = toHuntFindingRows('s1', [
      { ...candidate, falsifierReason: 'nothing refutes it' },
    ])
    expect(row).toMatchObject({
      scanId: 's1',
      kind: 'VULNERABILITY',
      ruleId: 'hunt:injection',
      severity: 'HIGH',
      provenance: 'LLM_JUDGE',
      filePath: 'lib/s.ts',
      line: 5,
      fingerprint: 'c'.repeat(16),
      externalRef: null,
      disposition: null,
      cwe: 'CWE-89',
      reachability: 'EXTERNAL',
      callChain: candidate.call_chain,
      falsifierVerdict: 'INCONCLUSIVE',
    })
    expect(row!.title).not.toContain(FAKE_AWS_KEY)
    expect(row!.detail).toContain(
      'Falsifier: INCONCLUSIVE — nothing refutes it'
    )
    expect(row!.evidence).toBe(
      'app/api/x/route.ts#POST → lib/s.ts#svc.run → lib/s.ts#prisma.$queryRawUnsafe@5'
    )
  })

  it('persist inherits dispositions and stamps RAN or PARTIAL with a capped audit', async () => {
    repo.findDispositionedByPullRequest.mockResolvedValue([
      {
        id: 'old',
        fingerprint: 'c'.repeat(16),
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'n',
        dispositionedById: 'm',
        dispositionedAt: new Date(0),
        suggestedDisposition: null,
        suggestedReason: null,
        suggestionOutcome: null,
      },
    ])
    const audit = {
      candidates: 1,
      rejected: Array.from({ length: 60 }, () => ({
        reason: 'duplicate',
        category: 'idor',
        sink: 's',
      })),
      falsifierRejects: 0,
      falsifierRejected: [],
      categories: [],
      subgraph: { files: 1, symbols: 1, edges: 1, partial: false },
    }
    await expect(
      securityHuntService.persist({
        job: JOB,
        findings: [{ ...candidate, falsifierReason: 'r' }],
        audit,
        tokenSpent: 777,
        partial: true,
      })
    ).resolves.toEqual({ written: 1 })
    const [scanId, rows, final] = repo.persistHuntResult.mock.calls[0]!
    expect(scanId).toBe('s1')
    expect(rows[0]).toMatchObject({
      disposition: 'FALSE_POSITIVE',
      inheritedFromFindingId: 'old',
    })
    expect(final).toMatchObject({
      hunt: 'PARTIAL',
      tokenSpent: 777,
      partial: true,
    })
    expect((final.huntAudit.rejected as unknown[]).length).toBe(50)
  })

  it('LUM-762 logs one per-category coverage line so a deploy log answers how long each category took', async () => {
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    await securityHuntService.persist({
      job: JOB,
      findings: [],
      audit: {
        candidates: 0,
        rejected: [],
        falsifierRejects: 0,
        falsifierRejected: [],
        categories: [
          {
            category: 'idor',
            candidates: 0,
            tokens: 900,
            elapsedMs: 41_200,
            stopped: 'done',
          },
          {
            category: 'injection',
            candidates: 0,
            tokens: 0,
            elapsedMs: 60_000,
            stopped: 'timeout',
          },
          {
            category: 'injection',
            candidates: 1,
            tokens: 800,
            elapsedMs: 12_000,
            stopped: 'done',
          },
        ],
        subgraph: { files: 1, symbols: 1, edges: 1, partial: false },
      },
      tokenSpent: 1700,
      partial: true,
    })
    const line = (logger.info as jest.Mock).mock.calls
      .map(c => String(c[0]))
      .find(c => c.includes('[security-hunt] coverage'))
    expect(line).toBe(
      '[security-hunt] coverage scan=s1 2/6 done · idor 41.2s done · injection 72.0s done (2 attempts)'
    )
  })

  it('markFailed stamps FAILED with the reason in huntAudit and the tokens spent', async () => {
    await securityHuntService.markFailed('s1', 'x'.repeat(600), 12)
    expect(repo.persistHuntResult).toHaveBeenCalledWith('s1', [], {
      hunt: 'FAILED',
      huntAudit: { error: 'x'.repeat(500) },
      tokenSpent: 12,
      partial: false,
    })
  })
})
