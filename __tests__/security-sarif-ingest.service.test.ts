/** @jest-environment node */
import { gzipSync } from 'node:zlib'

// LUM-866: every workspace here has the default switches (all on); the
// platform env in each test still decides the ceiling.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn(p => p) }))
jest.mock('@/lib/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
  listSarifBlobs: jest.fn(),
}))
// LUM-735 Task 2: stage A now statically imports the PR write-back service,
// which reaches `github/auth` → `@octokit/auth-app` (ESM, unparseable by
// jest). Nothing in this suite talks to GitHub, so stub the token source.
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
// LUM-889: resolveScan checks each owner's confirmed list; every repository
// here is confirmed (the unconfirmed path is __tests__/lum889-token-tails.test.ts).
jest.mock('@/lib/integrations/github/confirmed-repositories', () => ({
  ...jest.requireActual('@/lib/integrations/github/confirmed-repositories'),
  loadConfirmedRepositories: async () => (repository: string) => repository,
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  // LUM-785: stage A's graph rules read touched files; null = not found.
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findAllByRepoAndNumber: jest.fn(),
    findById: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    markSarifIngested: jest.fn(),
    findLastSarifIngestAt: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    createIfAbsent: jest.fn(),
    ingestExternalFindings: jest.fn(),
    mergeStages: jest.fn(),
    findDispositionedByPullRequest: jest.fn(),
  },
}))
jest.mock('@/lib/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))
// `pr-security-scan.service` (imported below for inheritDispositions /
// DETECTOR_VERSION) transitively imports the managed-scan workflow chain
// down to `@vercel/sandbox`, which ships pure ESM and cannot be loaded by
// Jest's CJS transform. Cut the chain here, the same way
// `pr-security-scan.service.test.ts` does.
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))

import {
  securitySarifIngestService,
  SARIF_MAX_GZ_BYTES,
  type PersistInput,
} from '@/lib/services/security-sarif-ingest.service'
import * as blob from '@/lib/services/security-sarif-blob'
import { waitUntil } from '@vercel/functions'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { logger } from '@/lib/logger'
import {
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  addedLinesWithNumbers,
  type RawSarifFinding,
} from '@/lib/security-scan'

const KEY = 'AKIAABCDEFGHIJKLMNOP'
const fetchBlob = blob.fetchPrivateBlob as jest.Mock
const delBlob = blob.deleteBlob as jest.Mock
const listBlobs = blob.listSarifBlobs as jest.Mock
const keepAlive = waitUntil as jest.Mock
const diff = fetchPrDiff as jest.Mock
const findPr = pullRequestRepository.findAllByRepoAndNumber as jest.Mock
const repo = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const dispatchStageA = dispatchPrSecurityScan as jest.Mock
const logInfo = logger.info as jest.Mock

const JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  workspaceId: 'w1',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}
const DIFF = [
  '--- a/src/db.ts',
  '+++ b/src/db.ts',
  '@@ -1,0 +1,2 @@',
  '+const a = 1',
  `+const k = "${KEY}"`,
].join('\n')
const sarifDoc = (results: unknown[], tool = 'Semgrep OSS') => ({
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: tool,
          rules: [
            {
              id: 'r1',
              shortDescription: { text: 'Rule one' },
              helpUri: 'https://h/1',
            },
          ],
        },
      },
      results,
    },
  ],
})
const result = (line: number, extra: object = {}) => ({
  ruleId: 'r1',
  level: 'error',
  message: { text: 'bad' },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri: 'src/db.ts' },
        region: { startLine: line, snippet: { text: `line ${line}` } },
      },
    },
  ],
  ...extra,
})

const SARIF_FIXTURE = sarifDoc([result(1), result(2), result(99)])
const GITLEAKS_FIXTURE = sarifDoc(
  [result(2, { message: { text: `Secret: ${KEY}` } })],
  'gitleaks'
)

const PR = {
  id: 'pr1',
  workspaceId: 'w1',
  repo: 'o/r',
  number: 7,
  taskId: null,
}
const RESOLVED_PR = { id: 'pr1', workspaceId: 'w1', repo: 'o/r', number: 7 }

const RAW_FINDING: RawSarifFinding = {
  kind: 'VULNERABILITY',
  ruleId: 'ext:semgrep-oss:r1',
  severity: 'HIGH',
  filePath: 'src/db.ts',
  line: 1,
  title: 'Rule one',
  detail: 'bad',
  evidence: '',
  fingerprint: 'fp-1',
  externalRef: 'https://h/1',
}

const PERSIST_INPUT: PersistInput = {
  scanId: 's1',
  pr: RESOLVED_PR,
  repository: 'o/r',
  prNumber: 7,
  auth: 'key',
  tool: 'semgrep-oss',
  tools: ['semgrep-oss'],
  findings: [RAW_FINDING],
  truncated: false,
  dropped: { notInDiff: 0, noLocation: 0, duplicate: 0 },
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a mockRejectedValue/mockImplementation
  // set by one test can never leak into a later one — every default below is
  // re-established fresh each test.
  jest.resetAllMocks()
  findPr.mockResolvedValue([
    {
      id: 'pr1',
      workspaceId: 'w1',
      taskId: 't1',
      repo: 'o/r',
      number: 7,
    },
  ])
  diff.mockResolvedValue(DIFF)
  repo.createIfAbsent.mockResolvedValue({
    id: 's1',
    created: true,
    status: 'PENDING',
    startedAt: new Date(),
  })
  repo.findDispositionedByPullRequest.mockResolvedValue([])
  repo.ingestExternalFindings.mockImplementation(async (_s, _t, rows) => ({
    written: rows.length,
    flippedToFindings: false,
  }))
  dispatchStageA.mockResolvedValue(undefined)
  delBlob.mockResolvedValue(undefined)
  keepAlive.mockImplementation(p => p)
})

describe('resolveScan', () => {
  it('discards when the PR is unknown, leaving the blob to the workflow', async () => {
    findPr.mockResolvedValue([])
    await expect(securitySarifIngestService.resolveScan(JOB)).resolves.toEqual({
      kind: 'discarded',
      reason: 'pr_not_found',
    })
    // The workflow deletes it through the retried deleteSarifBlobStep.
    expect(delBlob).not.toHaveBeenCalled()
    expect(repo.createIfAbsent).not.toHaveBeenCalled()
  })

  it('discards when the key workspace does not own the PR, leaving the blob to the workflow', async () => {
    findPr.mockResolvedValue([{ ...PR, workspaceId: 'other' }])
    await expect(securitySarifIngestService.resolveScan(JOB)).resolves.toEqual({
      kind: 'discarded',
      reason: 'workspace_mismatch',
    })
    expect(delBlob).not.toHaveBeenCalled()
  })

  it('skips the workspace check on the OIDC path (no workspaceId)', async () => {
    findPr.mockResolvedValue([{ ...PR, workspaceId: 'other' }])
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: false,
      status: 'RUNNING',
      startedAt: new Date(),
    })
    const { workspaceId: _omit, ...oidcJob } = JOB
    void _omit
    await expect(
      securitySarifIngestService.resolveScan(oidcJob)
    ).resolves.toEqual({
      kind: 'ok',
      scanId: 's1',
      pr: { ...RESOLVED_PR, workspaceId: 'other' },
    })
  })

  it('creates a PENDING SARIF_PUSH row and dispatches stage A when it created the row', async () => {
    findPr.mockResolvedValue([PR])
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: true,
      status: 'PENDING',
      startedAt: new Date(),
    })
    await securitySarifIngestService.resolveScan(JOB)
    expect(repo.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: 'pr1',
        headSha: 'sha1',
        trigger: 'SARIF_PUSH',
        status: 'PENDING',
      })
    )
    expect(dispatchStageA).toHaveBeenCalledWith('pr1', 'SARIF_PUSH')
  })

  it('hands the stage-A dispatch to waitUntil instead of awaiting it', async () => {
    // Stage A runs synchronously inside the internal worker route (up to
    // maxDuration = 300s) and the dispatch fetch has no timeout, so awaiting
    // it here would hold the ingest step open for minutes. The step must
    // return at once; waitUntil keeps the function alive for the dispatch.
    findPr.mockResolvedValue([PR])
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: true,
      status: 'PENDING',
      startedAt: new Date(),
    })
    let settle: () => void = () => {}
    const pending = new Promise<void>(res => {
      settle = res
    })
    dispatchStageA.mockReturnValue(pending)
    // Resolves even though the dispatch has not settled — nothing awaited it.
    await expect(
      securitySarifIngestService.resolveScan(JOB)
    ).resolves.toMatchObject({ kind: 'ok', scanId: 's1' })
    expect(keepAlive).toHaveBeenCalledTimes(1)
    expect(keepAlive).toHaveBeenCalledWith(pending)
    settle()
    await pending
  })

  it('does not dispatch stage A (nor call waitUntil) when the row already existed', async () => {
    findPr.mockResolvedValue([PR])
    repo.createIfAbsent.mockResolvedValue({
      id: 's1',
      created: false,
      status: 'RUNNING',
      startedAt: new Date(),
    })
    await securitySarifIngestService.resolveScan(JOB)
    expect(dispatchStageA).not.toHaveBeenCalled()
    expect(keepAlive).not.toHaveBeenCalled()
  })

  // LUM-924 — workspaces sharing a GitHub App installation each hold a row
  // for the PR; an OIDC push proves the repository, so each gets a scan.
  it('ingests an OIDC report into every workspace that holds the PR', async () => {
    findPr.mockResolvedValue([
      { ...PR, id: 'pr-a', workspaceId: 'w-a' },
      { ...PR, id: 'pr-b', workspaceId: 'w-b', taskId: 't-b' },
    ])
    repo.createIfAbsent.mockImplementation(
      async ({ pullRequestId }: { pullRequestId: string }) => ({
        id: `scan-${pullRequestId}`,
        created: true,
        status: 'PENDING',
        startedAt: new Date(),
      })
    )
    const { workspaceId: _omit, ...oidcJob } = JOB
    void _omit
    await expect(
      securitySarifIngestService.resolveScan(oidcJob)
    ).resolves.toEqual({
      kind: 'ok',
      scanId: 'scan-pr-a',
      pr: { ...RESOLVED_PR, id: 'pr-a', workspaceId: 'w-a' },
      others: [
        {
          scanId: 'scan-pr-b',
          pr: { ...RESOLVED_PR, id: 'pr-b', workspaceId: 'w-b' },
        },
      ],
    })
    expect(repo.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: 'pr-b',
        workspaceId: 'w-b',
        taskId: 't-b',
      })
    )
    expect(dispatchStageA).toHaveBeenCalledWith('pr-a', 'SARIF_PUSH')
    expect(dispatchStageA).toHaveBeenCalledWith('pr-b', 'SARIF_PUSH')

    // An ApiKey push stays inside the key's workspace even when another
    // workspace holds the same PR.
    repo.createIfAbsent.mockClear()
    await expect(
      securitySarifIngestService.resolveScan({ ...JOB, workspaceId: 'w-b' })
    ).resolves.toEqual({
      kind: 'ok',
      scanId: 'scan-pr-b',
      pr: { ...RESOLVED_PR, id: 'pr-b', workspaceId: 'w-b' },
    })
    expect(repo.createIfAbsent).toHaveBeenCalledTimes(1)
  })

  it('propagates a DB failure so the step retries', async () => {
    findPr.mockRejectedValue(new Error('db down'))
    await expect(securitySarifIngestService.resolveScan(JOB)).rejects.toThrow(
      'db down'
    )
  })
})

describe('fetchAndNormalize', () => {
  const INPUT = { url: JOB.url, tool: 'semgrep', scanId: 's1', pr: RESOLVED_PR }

  it('returns not_found when the blob is already gone', async () => {
    fetchBlob.mockResolvedValue(null)
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toEqual({ kind: 'not_found' })
    expect(fetchBlob).toHaveBeenCalledWith(INPUT.url, SARIF_MAX_GZ_BYTES)
  })

  it('throws (retryable) when the blob store errors', async () => {
    fetchBlob.mockRejectedValue(new Error('blob 503'))
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).rejects.toThrow('blob 503')
  })

  it('returns failed (not retried) for an over-cap blob', async () => {
    fetchBlob.mockRejectedValue(
      Object.assign(new Error('gzip size 999 exceeds cap'), { status: 413 })
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toEqual({
      kind: 'failed',
      reason: expect.stringContaining('exceeds cap'),
    })
  })

  it('returns failed for a non-gzip body and for a non-2.1.0 document', async () => {
    fetchBlob.mockResolvedValue(Buffer.from('not gzip'))
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toMatchObject({ kind: 'failed' })
    fetchBlob.mockResolvedValue(
      gzipSync(JSON.stringify({ version: '2.0.0', runs: [] }))
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).resolves.toMatchObject({ kind: 'failed' })
  })

  it('throws when the diff fetch fails (retryable)', async () => {
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(SARIF_FIXTURE)))
    diff.mockRejectedValue(new Error('github 502'))
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).rejects.toThrow('github 502')
  })

  it('throws (retryable), not classified as a deterministic SARIF failure, when GitHub returns 422 for the diff', async () => {
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(SARIF_FIXTURE)))
    diff.mockRejectedValue(
      Object.assign(new Error('GitHub API error 422 for PR o/r#7'), {
        status: 422,
      })
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).rejects.toThrow('GitHub API error 422')
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('FAILED tool=')
    )
  })

  it('throws (retryable) when GitHub returns 404 for the diff', async () => {
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(SARIF_FIXTURE)))
    diff.mockRejectedValue(
      Object.assign(new Error('GitHub API error 404 for PR o/r#7'), {
        status: 404,
      })
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize(INPUT)
    ).rejects.toThrow('GitHub API error 404')
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.stringContaining('FAILED tool=')
    )
  })

  it('keeps only findings on added lines and reports drops', async () => {
    // Port of the old happy-path test's diff-aware assertions: DIFF only adds
    // lines 1-2 of src/db.ts, so result(99) is dropped as notInDiff while
    // result(1)/result(2) survive.
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(SARIF_FIXTURE)))
    diff.mockResolvedValue(DIFF)
    const out = await securitySarifIngestService.fetchAndNormalize(INPUT)
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`)
    expect(out.tool).toBe('semgrep-oss')
    expect(out.tools).toEqual(['semgrep-oss'])
    expect(out.findings).toHaveLength(2)
    expect(out.findings.map(f => f.line).sort()).toEqual([1, 2])
    expect(out.dropped).toEqual({ notInDiff: 1, noLocation: 0, duplicate: 0 })
    expect(out.truncated).toBe(false)
  })

  it('RED LINE: no field of the returned findings contains the plaintext key', async () => {
    fetchBlob.mockResolvedValue(gzipSync(JSON.stringify(GITLEAKS_FIXTURE)))
    diff.mockResolvedValue(DIFF)
    const out = await securitySarifIngestService.fetchAndNormalize({
      ...INPUT,
      tool: 'gitleaks',
    })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`)
    expect(out.findings.length).toBeGreaterThan(0)
    expect(out.findings[0]).toMatchObject({ kind: 'SECRET' })
    expect(JSON.stringify(out)).not.toContain(KEY)
  })
})

describe('persistFindings', () => {
  it('LUM-896 write path rechecks the confirmed list after the SARIF rows land', async () => {
    const { scrubScanIfRepositoryUnconfirmed: recheck } = jest.requireMock(
      '@/lib/services/scan-code-retention.service'
    ) as { scrubScanIfRepositoryUnconfirmed: jest.Mock }
    recheck.mockClear()
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    repo.ingestExternalFindings.mockResolvedValue({
      written: 1,
      flippedToFindings: false,
    })
    await securitySarifIngestService.persistFindings(PERSIST_INPUT)
    expect(recheck).toHaveBeenCalledWith('s1')
    expect(recheck.mock.invocationCallOrder[0]!).toBeGreaterThan(
      repo.ingestExternalFindings.mock.invocationCallOrder[
        repo.ingestExternalFindings.mock.invocationCallOrder.length - 1
      ]!
    )
  })

  it('replaces this push’s tools, stamps lastSarifIngestAt and returns written/partial', async () => {
    // Port of the old ingestExternalFindings assertions: tools list,
    // EXTERNAL_TOOL provenance, inheritDispositions applied, partial =
    // truncated, and the CLEAN→FINDINGS flip is only reported (logged), not
    // decided by the service itself.
    repo.findDispositionedByPullRequest.mockResolvedValue([
      {
        id: 'old',
        fingerprint: 'fp-1',
        disposition: 'FALSE_POSITIVE',
        dispositionNote: 'n',
        dispositionedById: 'm',
        dispositionedAt: new Date(),
        suggestedDisposition: null,
        suggestedReason: null,
        suggestionOutcome: null,
      },
    ])
    repo.ingestExternalFindings.mockResolvedValue({
      written: 1,
      flippedToFindings: true,
    })
    const input: PersistInput = { ...PERSIST_INPUT, truncated: true }
    const out = await securitySarifIngestService.persistFindings(input)
    expect(out).toEqual({ written: 1, partial: true })
    expect(repo.ingestExternalFindings).toHaveBeenCalledWith(
      's1',
      ['semgrep-oss'],
      expect.any(Array),
      { partialCauses: ['EXTERNAL_TRUNCATED'], stage: 'external' }
    )
    const rows = repo.ingestExternalFindings.mock.calls[0]![2]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      scanId: 's1',
      provenance: 'EXTERNAL_TOOL',
      ruleId: 'ext:semgrep-oss:r1',
      disposition: 'FALSE_POSITIVE',
      inheritedFromFindingId: 'old',
    })
    expect(projectRepository.markSarifIngested).toHaveBeenCalledWith(
      'w1',
      'o/r',
      expect.any(Date)
    )
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('scan flipped CLEAN→FINDINGS')
    )
    expect(repo.mergeStages).not.toHaveBeenCalled()
  })

  it('RED LINE: nothing handed to the repository or the logger contains the plaintext key', async () => {
    // Port of the old RED LINE test, now exercised at the persist boundary:
    // real normalizeSarif output for a gitleaks-style hit is handed to
    // persistFindings, and neither the repository call nor the log line may
    // carry the plaintext key.
    const normalized = normalizeSarif(parseSarif(GITLEAKS_FIXTURE), {
      toolHint: 'gitleaks',
      changedLines: changedLinesOf(addedLinesWithNumbers(DIFF)),
    })
    const input: PersistInput = {
      ...PERSIST_INPUT,
      tool: 'gitleaks',
      tools: normalized.tools,
      findings: normalized.findings,
      truncated: normalized.truncated,
      dropped: normalized.dropped,
    }
    await securitySarifIngestService.persistFindings(input)
    const rows = repo.ingestExternalFindings.mock.calls[0]![2]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toMatchObject({
      kind: 'SECRET',
      provenance: 'EXTERNAL_TOOL',
    })
    expect(
      JSON.stringify(repo.ingestExternalFindings.mock.calls)
    ).not.toContain(KEY)
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain(KEY)
  })

  it('propagates a write failure so the step retries', async () => {
    repo.ingestExternalFindings.mockRejectedValue(new Error('P1001'))
    await expect(
      securitySarifIngestService.persistFindings(PERSIST_INPUT)
    ).rejects.toThrow('P1001')
  })

  it('does not stamp lastSarifIngestAt for a managed scan (must not poison the kill switch)', async () => {
    const input: PersistInput = { ...PERSIST_INPUT, auth: 'managed' }
    await securitySarifIngestService.persistFindings(input)
    expect(projectRepository.markSarifIngested).not.toHaveBeenCalled()
  })

  it('still stamps lastSarifIngestAt for an OIDC (BYO CI) push', async () => {
    const input: PersistInput = { ...PERSIST_INPUT, auth: 'oidc' }
    await securitySarifIngestService.persistFindings(input)
    expect(projectRepository.markSarifIngested).toHaveBeenCalledWith(
      'w1',
      'o/r',
      expect.any(Date)
    )
  })
})

describe('markExternalFailed / deleteBlobSafely', () => {
  it('markExternalFailed merges external=FAILED', async () => {
    await expect(
      securitySarifIngestService.markExternalFailed('s1')
    ).resolves.toBeUndefined()
    expect(repo.mergeStages).toHaveBeenCalledWith(
      's1',
      { external: 'FAILED' },
      {}
    )
  })

  it('markExternalFailed with a reason writes the scrubbed, prefixed, capped error', async () => {
    // LUM-735 Task 1 — P8: the reason is already scrubbed by the caller
    // (reasonOf / scrubToken); this only prefixes and caps it.
    await expect(
      securitySarifIngestService.markExternalFailed('s1', 'boom')
    ).resolves.toBeUndefined()
    expect(repo.mergeStages).toHaveBeenCalledWith(
      's1',
      { external: 'FAILED' },
      { error: 'external: boom' }
    )
  })

  it('markExternalFailed caps the reason at 480 chars before prefixing', async () => {
    const long = 'x'.repeat(600)
    await securitySarifIngestService.markExternalFailed('s1', long)
    expect(repo.mergeStages).toHaveBeenCalledWith(
      's1',
      { external: 'FAILED' },
      { error: `external: ${'x'.repeat(480)}` }
    )
  })

  it('markExternalFailed propagates so the step retries the P9 stamp', async () => {
    repo.mergeStages.mockRejectedValue(new Error('again'))
    await expect(
      securitySarifIngestService.markExternalFailed('s1')
    ).rejects.toThrow('again')
  })

  it('deleteBlobSafely returns false and warns instead of throwing', async () => {
    delBlob.mockRejectedValue(new Error('nope'))
    await expect(
      securitySarifIngestService.deleteBlobSafely(JOB.url)
    ).resolves.toBe(false)
  })
})

describe('pruneStaleBlobs', () => {
  it('deletes only security-sarif blobs older than 48h (never a failed run still inside its 24h sleep)', async () => {
    const now = new Date('2026-09-10T00:00:00Z')
    listBlobs.mockResolvedValue([
      { url: 'u-old', uploadedAt: new Date('2026-09-07T23:00:00Z') },
      { url: 'u-failed-run', uploadedAt: new Date('2026-09-08T12:00:00Z') },
      { url: 'u-new', uploadedAt: new Date('2026-09-09T23:00:00Z') },
    ])
    expect(await securitySarifIngestService.pruneStaleBlobs(now)).toEqual({
      deleted: 1,
      failed: 0,
    })
    expect(delBlob).toHaveBeenCalledWith('u-old')
    expect(delBlob).not.toHaveBeenCalledWith('u-failed-run')
    expect(delBlob).not.toHaveBeenCalledWith('u-new')
  })

  it('continues past a failed delete and reports it separately', async () => {
    const now = new Date('2026-09-10T00:00:00Z')
    listBlobs.mockResolvedValue([
      { url: 'u-old-1', uploadedAt: new Date('2026-09-07T00:00:00Z') },
      { url: 'u-old-2', uploadedAt: new Date('2026-09-07T00:00:00Z') },
    ])
    delBlob
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    expect(await securitySarifIngestService.pruneStaleBlobs(now)).toEqual({
      deleted: 1,
      failed: 1,
    })
    expect(delBlob).toHaveBeenCalledWith('u-old-1')
    expect(delBlob).toHaveBeenCalledWith('u-old-2')
  })
})

// ── LUM-738: baseline membership + supply-chain stage ───────────────────────

describe('LUM-738 baseline — persistFindings', () => {
  const findBaseline = projectRepository.findSecurityBaseline as jest.Mock
  const baseline = (
    over: Partial<{ at: string | null; fingerprints: string[] }> = {}
  ) => ({
    sha: 'b'.repeat(40),
    at: '2026-09-10T00:00:00.000Z',
    requestedAt: '2026-09-10T00:00:00.000Z',
    fingerprints: ['fp-1'],
    partial: false,
    tools: ['osv-scanner'],
    ...over,
  })
  const two = (): PersistInput => ({
    ...PERSIST_INPUT,
    stage: 'supplyChain',
    tool: 'osv-scanner',
    tools: ['osv-scanner'],
    findings: [
      {
        ...PERSIST_INPUT.findings[0]!,
        kind: 'DEPENDENCY',
        ruleId: 'ext:osv-scanner:GHSA-1',
        fingerprint: 'fp-1',
        line: null,
      },
      {
        ...PERSIST_INPUT.findings[0]!,
        kind: 'DEPENDENCY',
        ruleId: 'ext:osv-scanner:GHSA-2',
        fingerprint: 'fp-2',
        line: null,
      },
    ],
  })

  beforeEach(() => {
    repo.findDispositionedByPullRequest.mockResolvedValue([])
    repo.ingestExternalFindings.mockResolvedValue({
      written: 2,
      flippedToFindings: false,
    })
  })

  it('flags a row whose fingerprint is on the landed baseline as persisting, the rest as new, and routes the stage', async () => {
    findBaseline.mockResolvedValue(baseline())
    await securitySarifIngestService.persistFindings(two())
    expect(projectRepository.findSecurityBaseline).toHaveBeenCalledWith(
      'w1',
      'o/r'
    )
    expect(repo.ingestExternalFindings).toHaveBeenCalledWith(
      's1',
      ['osv-scanner'],
      [
        expect.objectContaining({
          fingerprint: 'fp-1',
          persisting: true,
          kind: 'DEPENDENCY',
        }),
        expect.objectContaining({ fingerprint: 'fp-2', persisting: false }),
      ],
      { partialCauses: [], stage: 'supplyChain' }
    )
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('stage=supplyChain persisting=1')
    )
  })

  it.each([
    ['no baseline', null],
    ['unlinked repo', undefined],
    ['baseline still in flight', { at: null }],
  ])('marks nothing persisting when there is %s', async (_label, value) => {
    findBaseline.mockResolvedValue(
      value && typeof value === 'object' ? baseline(value) : value
    )
    await securitySarifIngestService.persistFindings(two())
    const rows = repo.ingestExternalFindings.mock.calls[0]![2] as Array<{
      persisting: boolean
    }>
    expect(rows.map(r => r.persisting)).toEqual([false, false])
  })

  it('applies the same baseline rule to semgrep rows on the external stage (replaces --baseline-commit)', async () => {
    findBaseline.mockResolvedValue(baseline({ fingerprints: ['fp'] }))
    await securitySarifIngestService.persistFindings({
      ...PERSIST_INPUT,
      findings: [{ ...PERSIST_INPUT.findings[0]!, fingerprint: 'fp' }],
    })
    expect(repo.ingestExternalFindings).toHaveBeenCalledWith(
      's1',
      expect.any(Array),
      [expect.objectContaining({ persisting: true })],
      { partialCauses: [], stage: 'external' }
    )
  })

  it('a persisting row still inherits a prior disposition on the same fingerprint', async () => {
    findBaseline.mockResolvedValue(baseline())
    repo.findDispositionedByPullRequest.mockResolvedValue([
      {
        id: 'old',
        fingerprint: 'fp-1',
        disposition: 'ACCEPTED_RISK',
        dispositionNote: null,
        dispositionedById: null,
        dispositionedAt: null,
        suggestedDisposition: null,
        suggestedReason: null,
        suggestionOutcome: null,
      },
    ])
    await securitySarifIngestService.persistFindings(two())
    const rows = repo.ingestExternalFindings.mock
      .calls[0]![2] as unknown as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({
      persisting: true,
      disposition: 'ACCEPTED_RISK',
      inheritedFromFindingId: 'old',
    })
  })
})

describe('LUM-738 supplyChain surface — stage stamps', () => {
  it('markExternalFailed with a patch stamps only the given layers (supplyChain FAILED, external untouched)', async () => {
    repo.mergeStages.mockResolvedValue(undefined)
    await securitySarifIngestService.markExternalFailed(
      's1',
      'osv-scanner exit 129',
      { supplyChain: 'FAILED' }
    )
    expect(repo.mergeStages).toHaveBeenCalledWith(
      's1',
      { supplyChain: 'FAILED' },
      { error: 'external: osv-scanner exit 129' }
    )
  })

  it('markExternalFailed without a patch keeps the LUM-735 default (external FAILED)', async () => {
    repo.mergeStages.mockResolvedValue(undefined)
    await securitySarifIngestService.markExternalFailed('s1')
    expect(repo.mergeStages).toHaveBeenCalledWith(
      's1',
      { external: 'FAILED' },
      {}
    )
  })

  it('markStages merges a row-less layer outcome (supplyChain SKIPPED) and propagates errors', async () => {
    repo.mergeStages.mockResolvedValue(undefined)
    await securitySarifIngestService.markStages('s1', {
      supplyChain: 'SKIPPED',
    })
    expect(repo.mergeStages).toHaveBeenCalledWith('s1', {
      supplyChain: 'SKIPPED',
    })
    repo.mergeStages.mockRejectedValueOnce(new Error('db'))
    await expect(
      securitySarifIngestService.markStages('s1', { supplyChain: 'SKIPPED' })
    ).rejects.toThrow('db')
  })
})
