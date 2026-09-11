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
jest.mock('@/lib/llm/security-hunt-client', () => ({ huntTask: jest.fn() }))
// LUM-758 Task 9: the batch now runs against a sandbox. The layer itself
// (attach-or-create, the credential guard, the command gate) is covered in
// `__tests__/security-scan/hunt/sandbox-agent.test.ts`; here it is a seam, so
// these tests can say what `huntBatch` does WITH it.
jest.mock('@/lib/services/security-hunt-sandbox', () => ({
  attachOrCreateHuntSandbox: jest.fn(),
  runHuntShell: jest.fn(),
  readHuntFile: jest.fn(),
  stopHuntSandbox: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))
jest.mock('@/lib/llm/security-hunt-plan-client', () => ({
  planHuntTasks: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findDispositionedByPullRequest: jest.fn(),
    persistHuntResult: jest.fn(),
    findFindingSummaryByScan: jest.fn(),
  },
}))

import {
  securityHuntService,
  toHuntFindingRows,
  candidateFilePaths,
  isVerifiableRepoPath,
} from '@/lib/services/security-hunt.service'
import { logger } from '@/lib/logger'
import { fetchPrDiff, readRepoFile } from '@/lib/integrations/github/contents'
import { huntTask } from '@/lib/llm/security-hunt-client'
import { falsifyCandidate } from '@/lib/llm/security-falsifier-client'
import { planHuntTasks } from '@/lib/llm/security-hunt-plan-client'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import {
  attachOrCreateHuntSandbox,
  runHuntShell,
  readHuntFile,
  stopHuntSandbox,
} from '@/lib/services/security-hunt-sandbox'
import { SUBGRAPH_MAX_FILES } from '@/lib/security-scan/graph/types'
import { HUNT_MIN_BATCH_TIME_MS } from '@/lib/services/security-hunt.config'

const diffMock = fetchPrDiff as jest.Mock
const readMock = readRepoFile as jest.Mock
const huntMock = huntTask as jest.Mock
const falsifyMock = falsifyCandidate as jest.Mock
const planMock = planHuntTasks as jest.Mock
const attachMock = attachOrCreateHuntSandbox as jest.Mock
const shellMock = runHuntShell as jest.Mock
const readHuntFileMock = readHuntFile as jest.Mock
const stopMock = stopHuntSandbox as jest.Mock

/** Stand-in for a scrubbed `HuntSandbox`; identity is what the tests check. */
const HANDLE = {
  sandbox: { name: 'vm1' },
  cwd: '/vercel/r',
  token: 'ghs_x',
  origin: 'attached' as const,
  egressDenied: false,
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
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
  reasons: ['diff:sink:prisma-raw'],
  managedScanStarted: true,
}

const TASK = {
  id: 't1',
  objective: 'the workspace id from the path reaches prisma.findMany unchecked',
  category: 'idor' as const,
  startingPoints: ['lib/s.ts'],
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
  attachMock.mockResolvedValue(HANDLE)
  shellMock.mockResolvedValue({ output: '' })
  readHuntFileMock.mockResolvedValue(null)
  stopMock.mockResolvedValue(undefined)
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.persistHuntResult.mockResolvedValue(undefined)
  repo.findFindingSummaryByScan.mockResolvedValue([])
})

describe('LUM-739 hunt service', () => {
  /**
   * LUM-758 Task 10 — the subgraph is a VERIFICATION tool now: built AFTER
   * the hunt, out of the files the candidates actually reference, read from
   * the sandbox checkout. It is never the agent's field of view, and it no
   * longer reports `partial`.
   */
  it('candidateFilePaths reads every level defensively — candidates have not been through zod yet', () => {
    expect(
      candidateFilePaths({
        entry: { file: 'a.ts', line: 1 },
        sink: { file: 'b.ts' },
        call_chain: [
          { from: 'c.ts#fn', to: 'd.ts#other@4' },
          { from: 'no-hash', to: 12 },
          null,
          'junk',
        ],
      })
    ).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    // Nothing here may throw, and nothing here may contribute a path.
    for (const junk of [
      null,
      undefined,
      'string',
      42,
      {},
      { entry: 'x', sink: 3, call_chain: {} },
      { entry: { file: 9 }, call_chain: [{}] },
    ]) {
      expect(candidateFilePaths(junk)).toEqual([])
    }
  })

  it('isVerifiableRepoPath admits repo-relative TS sources only', () => {
    expect(isVerifiableRepoPath('lib/a.ts')).toBe(true)
    expect(isVerifiableRepoPath('app/x/page.tsx')).toBe(true)
    expect(isVerifiableRepoPath('lib/a.d.ts')).toBe(false)
    expect(isVerifiableRepoPath('docs/a.md')).toBe(false)
    expect(isVerifiableRepoPath('/etc/a.ts')).toBe(false)
    expect(isVerifiableRepoPath('../a.ts')).toBe(false)
    expect(isVerifiableRepoPath('lib/../../a.ts')).toBe(false)
  })

  it('buildVerifySubgraph builds from the files the CANDIDATES reference, read from the sandbox and never from GitHub', async () => {
    readHuntFileMock.mockImplementation(async (_h: unknown, path: string) => {
      if (path === 'app/api/x/route.ts')
        return `import { svc } from '@/lib/s'\nexport async function POST() { return svc.run() }\n`
      if (path === 'lib/s.ts')
        return `export const svc = { run() { return 1 } }\n`
      return null
    })

    const graph = await securityHuntService.buildVerifySubgraph({
      job: JOB,
      candidates: [
        {
          entry: { file: 'app/api/x/route.ts', line: 2 },
          sink: { file: 'lib/s.ts', line: 1 },
          call_chain: [
            { from: 'app/api/x/route.ts#POST', to: 'lib/s.ts#svc.run' },
          ],
        },
        // A non-source path, a file that is not there, and junk at every
        // level: candidates have NOT been through zod at this point, so path
        // collection has to survive all of it.
        { entry: { file: 'docs/a.md' }, sink: { file: 'lib/gone.ts' } },
        { entry: 'not-an-object', call_chain: [null, { from: 42 }, 'x'] },
        { sink: { file: 7 }, call_chain: 'nope' },
        null,
        'nonsense',
      ],
    })

    expect(readHuntFileMock.mock.calls.map(c => c[1])).toEqual([
      'app/api/x/route.ts',
      'lib/gone.ts',
      'lib/s.ts',
    ])
    expect(graph.files.map(f => f.path)).toEqual([
      'app/api/x/route.ts',
      'lib/s.ts',
    ])
    expect(graph.edges).toContainEqual({
      from: 'app/api/x/route.ts#POST',
      to: 'lib/s.ts#svc.run',
    })
    // The checkout is right there — verification must not pay for GitHub.
    expect(readMock).not.toHaveBeenCalled()
    expect(diffMock).not.toHaveBeenCalled()
  })

  it('buildVerifySubgraph reads at most SUBGRAPH_MAX_FILES files, and reports no partial at all', async () => {
    readHuntFileMock.mockResolvedValue('export const x = 1\n')
    const candidates = Array.from(
      { length: SUBGRAPH_MAX_FILES + 5 },
      (_, i) => ({ sink: { file: `lib/f${String(i).padStart(2, '0')}.ts` } })
    )

    const graph = await securityHuntService.buildVerifySubgraph({
      job: JOB,
      candidates,
    })

    expect(readHuntFileMock).toHaveBeenCalledTimes(SUBGRAPH_MAX_FILES)
    expect(graph.files).toHaveLength(SUBGRAPH_MAX_FILES)
    // The cap bounds what VERIFICATION reads. It is not a field of view, and
    // there is no `partial` on this return type any more (LUM-762's main
    // source of PARTIAL).
    expect(graph).not.toHaveProperty('partial')
  })

  it('buildVerifySubgraph never reads outside the checkout, whatever path a candidate names', async () => {
    readHuntFileMock.mockResolvedValue('export const x = 1\n')

    const graph = await securityHuntService.buildVerifySubgraph({
      job: JOB,
      candidates: [
        { sink: { file: '../../../etc/evil.ts' } },
        { sink: { file: '/etc/evil.ts' } },
        { entry: { file: 'lib/a/../../b.ts' } },
        { call_chain: [{ from: '../outside.ts#x', to: 'lib/ok.ts#y' }] },
      ],
    })

    expect(readHuntFileMock.mock.calls.map(c => c[1])).toEqual(['lib/ok.ts'])
    expect(graph.files.map(f => f.path)).toEqual(['lib/ok.ts'])
  })

  it('buildVerifySubgraph attaches the same way huntBatch does and releases the VM even when a read throws', async () => {
    readHuntFileMock.mockRejectedValueOnce(new Error('sandbox gone'))

    await expect(
      securityHuntService.buildVerifySubgraph({
        job: JOB,
        candidates: [{ sink: { file: 'lib/a.ts' } }],
      })
    ).rejects.toThrow('sandbox gone')

    expect(attachMock).toHaveBeenCalledWith({
      scanId: JOB.scanId,
      workspaceId: JOB.workspaceId,
      repo: JOB.repo,
      headSha: JOB.headSha,
      managedScanStarted: JOB.managedScanStarted,
    })
    // `stopHuntSandbox` is the only one that knows an ATTACHED VM must be
    // left running: stopping it would kill the managed scan's semgrep.
    expect(stopMock).toHaveBeenCalledWith(HANDLE)
  })

  const batchInput = (over: Partial<{ timeBudgetMs: number }> = {}) => ({
    job: JOB,
    task: TASK,
    tokenBudget: 1000,
    timeBudgetMs: 60_000,
    ...over,
  })

  it('huntBatch runs the task in a sandbox and injects a runShell that is the ONLY route to it', async () => {
    shellMock.mockResolvedValue({ output: 'hit.ts:3' })
    huntMock.mockImplementation(
      async (input: {
        runShell: (c: string) => Promise<{ output: string }>
      }) => {
        // Quotes and a pipe: whatever the model sends must arrive unchanged.
        const command = 'rg -n "req\\.query" lib/ | head -n 5'
        await input.runShell(command)
        return { candidates: [{ raw: 1 }], tokens: 321, stopped: 'done' }
      }
    )

    const out = await securityHuntService.huntBatch(batchInput())

    expect(out).toMatchObject({
      candidates: [{ raw: 1 }],
      tokens: 321,
      stopped: 'done',
      sandbox: 'attached',
      egressDenied: false,
    })
    expect(attachMock.mock.calls[0]![0]).toEqual({
      scanId: JOB.scanId,
      workspaceId: JOB.workspaceId,
      repo: JOB.repo,
      headSha: JOB.headSha,
      managedScanStarted: true,
    })
    // The WHOLE handle is forwarded — never a loose `{ sandbox, cwd, token }`
    // — so the credential guard cannot be skipped by construction. And the
    // command is byte-identical to what the client sent.
    expect(shellMock).toHaveBeenCalledTimes(1)
    const shellArg = shellMock.mock.calls[0]![0]
    expect(shellArg.handle).toBe(HANDLE)
    expect(shellArg.command).toBe('rg -n "req\\.query" lib/ | head -n 5')
    expect(Object.keys(shellArg).sort()).toEqual(['command', 'handle'])
    // LUM-758: the client is handed the whole TASK (objective + starting
    // points), not just the category that types its output.
    expect(huntMock.mock.calls[0]![0]).toMatchObject({
      task: TASK,
      reasons: JOB.reasons,
      tokenBudget: 1000,
      maxSteps: 12,
    })
    // …and the file reader is gone: the checkout, not the GitHub API.
    expect(huntMock.mock.calls[0]![0].readFile).toBeUndefined()
    // LUM-758 Task 10: no subgraph is serialised into a batch's step input
    // any more — the agent stopped reading it in Task 9.
    expect(huntMock.mock.calls[0]![0].subgraph).toBeUndefined()
    expect(readMock).not.toHaveBeenCalled()
    expect(stopMock).toHaveBeenCalledWith(HANDLE)
  })

  it('huntBatch charges sandbox acquisition to the batch clock and to the model call window', async () => {
    attachMock.mockImplementation(async () => {
      await sleep(30)
      return HANDLE
    })
    huntMock.mockResolvedValue({ candidates: [], tokens: 0, stopped: 'done' })

    const out = await securityHuntService.huntBatch(batchInput())

    // Worst case in production is ~50 s of attach poll + checkout wait. The
    // orchestrator spends HUNT_TIME_BUDGET_MS on `elapsedMs`, so those seconds
    // have to be IN it…
    expect(out.elapsedMs).toBeGreaterThanOrEqual(30)
    // …and they come off the model's window, or a 60 s batch would really run
    // for 110 s and starve the task behind it.
    const { timeoutMs } = huntMock.mock.calls[0]![0]
    expect(timeoutMs).toBeLessThanOrEqual(60_000 - 30)
    expect(timeoutMs).toBeGreaterThan(50_000)
  })

  it('huntBatch does not start a model call on a window acquisition already ate', async () => {
    attachMock.mockImplementation(async () => {
      await sleep(5)
      return HANDLE
    })

    const out = await securityHuntService.huntBatch(
      batchInput({ timeBudgetMs: HUNT_MIN_BATCH_TIME_MS })
    )

    expect(huntMock).not.toHaveBeenCalled()
    // A recorded fact, not a thrown transient: the retry pass gets a fresh
    // window, by which time there is usually a VM to attach to.
    expect(out).toMatchObject({
      stopped: 'timeout',
      tokens: 0,
      sandbox: 'attached',
      error: 'sandbox acquisition consumed the task window',
    })
    expect(stopMock).toHaveBeenCalledWith(HANDLE)
  })

  it('huntBatch never throws for an LLM failure: a timeout is a "timeout" batch, anything else an "error" batch, and the VM is released either way', async () => {
    const input = {
      ...batchInput(),
      task: { ...TASK, id: 't9', category: 'ssrf' as const },
    }
    huntMock.mockRejectedValueOnce(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    )
    await expect(securityHuntService.huntBatch(input)).resolves.toMatchObject({
      candidates: [],
      tokens: 0,
      stopped: 'timeout',
      error: 'timed out',
      // The VM is a fact about the attempt even when the model failed.
      sandbox: 'attached',
      egressDenied: false,
    })
    huntMock.mockRejectedValueOnce(new Error('gateway 500'))
    await expect(securityHuntService.huntBatch(input)).resolves.toMatchObject({
      stopped: 'error',
      error: 'gateway 500',
    })
    expect(stopMock).toHaveBeenCalledTimes(2)
  })

  it('huntBatch records the VM it created, egress and all', async () => {
    attachMock.mockResolvedValue({
      ...HANDLE,
      origin: 'created',
      egressDenied: true,
    })
    huntMock.mockResolvedValue({ candidates: [], tokens: 5, stopped: 'done' })

    await expect(
      securityHuntService.huntBatch(batchInput())
    ).resolves.toMatchObject({ sandbox: 'created', egressDenied: true })
  })

  it('huntBatch THROWS when the VM cannot be acquired — including the credential guard refusing', async () => {
    // Deliberately on the other side of the try/catch from the LLM call: a
    // task that never started has no result to record, so the step's retry
    // policy gets it and a final failure reads FAILED (P9), not PARTIAL.
    attachMock.mockRejectedValueOnce(
      new Error('installation token still reachable in the checkout')
    )
    await expect(securityHuntService.huntBatch(batchInput())).rejects.toThrow(
      'installation token still reachable'
    )
    expect(huntMock).not.toHaveBeenCalled()
    // Nothing to release: the guard stops any VM it created before throwing.
    expect(stopMock).not.toHaveBeenCalled()
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

  it('planHunt returns the model plan tagged by: "model" and reads finding summaries into the client input', async () => {
    repo.findFindingSummaryByScan.mockResolvedValueOnce([
      { severity: 'HIGH', ruleId: 'hunt:idor', title: 'no owner check' },
    ])
    const planned = [
      {
        id: 't1',
        objective: 'the workspace id from the path reaches prisma.findMany',
        category: 'idor' as const,
        startingPoints: ['lib/s.ts'],
      },
    ]
    planMock.mockResolvedValueOnce({
      tasks: planned,
      reason: 'unscoped read',
      tokens: 42,
    })
    const job = {
      ...JOB,
      reasons: ['diff:entry:next-route-handler', 'diff:sink:prisma-raw'],
    }
    const out = await securityHuntService.planHunt({ job })
    expect(out).toEqual({
      tasks: planned,
      reason: 'unscoped read',
      tokens: 42,
      by: 'model',
    })
    expect(repo.findFindingSummaryByScan).toHaveBeenCalledWith(job.scanId)
    const arg = planMock.mock.calls[0]![0]
    // LUM-758 Task 10: the planner's diff view IS `job.reasons` now — there
    // is no subgraph to render files or signals from, and building one just
    // to route would be the up-front cost this task exists to remove.
    expect(arg.reasons).toEqual(job.reasons)
    expect(arg).not.toHaveProperty('files')
    expect(arg).not.toHaveProperty('signals')
    expect(arg.findings).toEqual([
      { severity: 'HIGH', ruleId: 'hunt:idor', title: 'no owner check' },
    ])
    expect(arg.timeoutMs).toBe(20_000)
  })

  it('planHunt never throws: an LLM failure falls back to the deterministic planner, never widening past what planFallback returns', async () => {
    planMock.mockRejectedValueOnce(new Error('gateway 500'))
    const job = { ...JOB, reasons: ['diff:sink:prisma-raw'] }
    const out = await securityHuntService.planHunt({ job })
    expect(out.by).toBe('fallback')
    // The deterministic planner maps the reason to a category, and the
    // fallback wraps it into a degenerate TASK — never a bare label.
    expect(out.tasks.map(t => t.category)).toEqual(['injection'])
    expect(out.tasks[0]!.startingPoints).toEqual([])
    expect(out.tasks[0]!.objective.length).toBeGreaterThan(20)
    expect(out.tokens).toBe(0)
    expect(out.reason).toContain('plan unavailable')
    expect(out.reason).toContain('gateway 500')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('using deterministic fallback')
    )
  })

  it('planHunt falls back to tasks: [] when the reasons map to nothing, never to all six categories', async () => {
    planMock.mockRejectedValueOnce(new Error('timed out'))
    const job = { ...JOB, reasons: [] }
    const out = await securityHuntService.planHunt({ job })
    expect(out.by).toBe('fallback')
    expect(out.tasks).toEqual([])
  })

  it('planHunt is best-effort about the finding-summary read: a repository failure logs a warning and planning continues with an empty finding list', async () => {
    repo.findFindingSummaryByScan.mockRejectedValueOnce(new Error('db down'))
    planMock.mockResolvedValueOnce({
      tasks: [],
      reason: 'nothing interesting',
      tokens: 10,
    })
    const job = { ...JOB, reasons: [] }
    const out = await securityHuntService.planHunt({ job })
    expect(out).toEqual({
      tasks: [],
      reason: 'nothing interesting',
      tokens: 10,
      by: 'model',
    })
    expect(planMock.mock.calls[0]![0].findings).toEqual([])
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('plan finding read failed')
    )
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
      tasks: [],
      subgraph: { files: 1, symbols: 1, edges: 1, partial: false },
    }
    await expect(
      securityHuntService.persist({
        job: JOB,
        findings: [{ ...candidate, falsifierReason: 'r' }],
        audit,
        tokenSpent: 777,
        partial: true,
        stage: 'PARTIAL',
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

  it('LUM-762 logs one per-task coverage line so a deploy log answers how long each task took', async () => {
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    await securityHuntService.persist({
      job: JOB,
      findings: [],
      audit: {
        candidates: 0,
        rejected: [],
        falsifierRejects: 0,
        falsifierRejected: [],
        tasks: [
          {
            taskId: 't1',
            objective: 'unscoped prisma read on the workspace route',
            category: 'idor',
            candidates: 0,
            tokens: 900,
            elapsedMs: 41_200,
            stopped: 'done',
          },
          {
            taskId: 't2',
            objective: 'raw SQL built from req.query in lib/db.ts',
            category: 'injection',
            candidates: 0,
            tokens: 0,
            elapsedMs: 60_000,
            stopped: 'timeout',
          },
          {
            taskId: 't2',
            objective: 'raw SQL built from req.query in lib/db.ts',
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
      stage: 'PARTIAL',
    })
    const line = (logger.info as jest.Mock).mock.calls
      .map(c => String(c[0]))
      .find(c => c.includes('[security-hunt] coverage'))
    expect(line).toBe(
      // LUM-758: each row is named by its TASK id — two rows may share a
      // category, and only the id tells them apart.
      '[security-hunt] coverage scan=s1 2/6 done · t1 idor 41.2s done · t2 injection 72.0s done (2 attempts)'
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
