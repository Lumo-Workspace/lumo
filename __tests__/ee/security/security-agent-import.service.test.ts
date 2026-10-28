/**
 * @jest-environment node
 *
 * LUM-1321 — `lumo review import`: a Claude Code / Codex security review
 * enters the SARIF ingest run of the caller's workspace PR, under the agent's
 * own tool name. Every refusal the ingest workflow would make silently is
 * made here, synchronously, with a reason.
 */
import { gunzipSync } from 'node:zlib'

jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findForSecurityImport: jest.fn() },
}))
const mockLoadConfirmedRepositories = jest.fn()
const mockResolveRenamedRepository = jest.fn()
jest.mock('@/lib/integrations/git-provider/resolve', () => ({
  gitProviderFor: () => ({
    loadConfirmedRepositories: mockLoadConfirmedRepositories,
    resolveRenamedRepository: mockResolveRenamedRepository,
  }),
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn(),
}))
jest.mock('@/ee/security/services/security-sarif-rate-limit', () => ({
  checkSarifIngestRateLimit: jest.fn(),
}))
jest.mock('@/ee/security/services/security-sarif-blob', () => ({
  putPrivateSarifBlob: jest.fn(),
  deleteBlob: jest.fn(),
}))
jest.mock('@/ee/security/services/security-sarif-ingest-start', () => ({
  startSecuritySarifIngest: jest.fn(),
}))

import { securityAgentImportService } from '@/ee/security/services/security-agent-import.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { loadSecurityLayers } from '@/ee/security/services/security-workspace-switches.service'
import { checkSarifIngestRateLimit } from '@/ee/security/services/security-sarif-rate-limit'
import {
  deleteBlob,
  putPrivateSarifBlob,
} from '@/ee/security/services/security-sarif-blob'
import { startSecuritySarifIngest } from '@/ee/security/services/security-sarif-ingest-start'
import {
  pathnameMatches,
  expectedSarifPathname,
} from '@/ee/security/validation/security-sarif'
import type { AgentImportBody } from '@/ee/security/validation/security-agent-import'

const findPr = pullRequestRepository.findForSecurityImport as jest.Mock
const confirmed = mockLoadConfirmedRepositories
const layers = loadSecurityLayers as jest.Mock
const rateLimit = checkSarifIngestRateLimit as jest.Mock
const put = putPrivateSarifBlob as jest.Mock
const del = deleteBlob as jest.Mock
const startRun = startSecuritySarifIngest as jest.Mock

const HEAD = 'a'.repeat(40)

const sarif = (driverName = 'whatever-the-agent-wrote') => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: driverName, rules: [{ id: 'sqli' }] } },
      results: [
        {
          ruleId: 'sqli',
          level: 'error',
          message: { text: 'user input reaches a raw query' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'app/api/x/route.ts' },
                region: { startLine: 12 },
              },
            },
          ],
        },
      ],
    },
  ],
})

const body = (over: Partial<AgentImportBody> = {}): AgentImportBody => ({
  repository: 'acme/app',
  prNumber: 7,
  headSha: HEAD,
  tool: 'claude-code',
  kind: 'security',
  sarif: sarif(),
  ...over,
})

const caller = { workspaceId: 'ws1', memberId: 'm1' }

beforeEach(() => {
  jest.clearAllMocks()
  findPr.mockResolvedValue({
    id: 'pr1',
    repo: 'acme/app',
    number: 7,
    state: 'open',
    headSha: HEAD,
  })
  confirmed.mockResolvedValue((r: string) => r)
  mockResolveRenamedRepository.mockResolvedValue(null)
  layers.mockResolvedValue({ scan: true })
  rateLimit.mockResolvedValue(undefined)
  put.mockImplementation(async (pathname: string) => ({
    url: `https://store.blob.vercel-storage.com/${pathname}`,
    pathname,
  }))
  startRun.mockResolvedValue('run_1')
})

describe('LUM-1333 a code review (kind bug)', () => {
  it('stores rules as bug kinds and asks the ingest to replace only the bug rows', async () => {
    const out = await securityAgentImportService.import(
      caller,
      body({ kind: 'bug' })
    )
    expect(out).toMatchObject({ kind: 'bug', results: 1 })
    const [, gz] = put.mock.calls[0]!
    const stored = JSON.parse(gunzipSync(gz).toString('utf8'))
    // `sqli` is no bug kind: it becomes logic_error, keeping its own rule.
    expect(stored.runs[0].results[0].ruleId).toBe('bug:logic_error:sqli')
    expect(stored.runs[0].tool.driver.rules).toEqual([
      { id: 'bug:logic_error:sqli' },
    ])
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentKind: 'bug' })
    )
  })
})

describe('LUM-1330 a renamed repository under its old name', () => {
  const renamedPr = {
    id: 'pr1',
    repo: 'acme/app-new',
    number: 7,
    state: 'open',
    headSha: HEAD,
  }

  it("finds the PR under the repository's current name and says it was renamed", async () => {
    findPr.mockImplementation(async (_ws: string, repo: string) =>
      repo === 'acme/app-new' ? renamedPr : null
    )
    mockResolveRenamedRepository.mockResolvedValue('acme/app-new')
    const out = await securityAgentImportService.import(caller, body())
    expect(mockResolveRenamedRepository).toHaveBeenCalledWith('ws1', 'acme/app')
    expect(out).toMatchObject({
      repository: 'acme/app-new',
      renamedFrom: 'acme/app',
    })
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'acme/app-new' })
    )
  })

  it('a name that is not renamed imports into its own PR, with no renamedFrom', async () => {
    const out = await securityAgentImportService.import(caller, body())
    expect(mockResolveRenamedRepository).toHaveBeenCalledWith('ws1', 'acme/app')
    expect(findPr).toHaveBeenCalledTimes(1)
    expect(out).not.toHaveProperty('renamedFrom')
  })

  it('a stale row left under the old name loses to the current repository', async () => {
    findPr.mockImplementation(async (_ws: string, repo: string) =>
      repo === 'acme/app-new'
        ? renamedPr
        : { ...renamedPr, id: 'stale', repo: 'acme/app' }
    )
    mockResolveRenamedRepository.mockResolvedValue('acme/app-new')
    const out = await securityAgentImportService.import(caller, body())
    expect(out).toMatchObject({
      repository: 'acme/app-new',
      renamedFrom: 'acme/app',
    })
  })

  it('no rename record: 404 that points at --repo', async () => {
    findPr.mockResolvedValue(null)
    await expect(
      securityAgentImportService.import(caller, body())
    ).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('--repo'),
    })
    expect(startRun).not.toHaveBeenCalled()
  })
})

describe('securityAgentImportService.import', () => {
  it('stores the report under the agent tool name and starts the ingest for the caller workspace', async () => {
    const out = await securityAgentImportService.import(caller, body())
    expect(out).toEqual({
      runId: 'run_1',
      repository: 'acme/app',
      prNumber: 7,
      headSha: HEAD,
      tool: 'claude-code',
      kind: 'security',
      results: 1,
    })
    expect(findPr).toHaveBeenCalledWith('ws1', 'acme/app', 7)
    expect(rateLimit).toHaveBeenCalledWith('member:ws1:m1')

    const [pathname, gz] = put.mock.calls[0]!
    expect(
      pathnameMatches(
        pathname,
        expectedSarifPathname({
          repository: 'acme/app',
          headSha: HEAD,
          tool: 'claude-code',
        })
      )
    ).toBe(true)
    const stored = JSON.parse(gunzipSync(gz).toString('utf8'))
    // Whatever the agent called itself, the rows are `ext:claude-code:…`.
    expect(stored.runs[0].tool.driver.name).toBe('claude-code')
    expect(stored.runs[0].tool.driver.rules).toEqual([{ id: 'sqli' }])

    expect(startRun).toHaveBeenCalledWith({
      url: `https://store.blob.vercel-storage.com/${pathname}`,
      pathname,
      workspaceId: 'ws1',
      repository: 'acme/app',
      headSha: HEAD,
      prNumber: 7,
      tool: 'claude-code',
      agentKind: 'security',
    })
  })

  it('cannot pose as a CI scanner: every run is renamed, so no import replaces semgrep rows', async () => {
    const doc = sarif('semgrep')
    doc.runs.push({ ...sarif('osv-scanner').runs[0]! })
    await securityAgentImportService.import(
      caller,
      body({ tool: 'codex', sarif: doc })
    )
    const stored = JSON.parse(
      gunzipSync(put.mock.calls[0]![1]).toString('utf8')
    )
    expect(
      stored.runs.map(
        (r: { tool: { driver: { name: string } } }) => r.tool.driver.name
      )
    ).toEqual(['codex', 'codex'])
    expect(startRun.mock.calls[0]![0].tool).toBe('codex')
  })

  it("uses the PR's stored repo name when origin is cased differently", async () => {
    await securityAgentImportService.import(
      caller,
      body({ repository: 'ACME/App' })
    )
    expect(findPr).toHaveBeenCalledWith('ws1', 'ACME/App', 7)
    expect(put.mock.calls[0]![0]).toMatch(/^security-sarif\/acme--app\//)
    expect(startRun.mock.calls[0]![0].repository).toBe('acme/app')
  })

  it('accepts a PR whose head is not known yet', async () => {
    findPr.mockResolvedValue({
      id: 'pr1',
      repo: 'acme/app',
      number: 7,
      state: 'open',
      headSha: null,
    })
    await expect(
      securityAgentImportService.import(caller, body())
    ).resolves.toMatchObject({ runId: 'run_1' })
  })

  it.each([
    [
      'no PR in this workspace',
      () => findPr.mockResolvedValue(null),
      404,
      /No GitHub pull request acme\/app#7/,
    ],
    [
      'a merged PR',
      () =>
        findPr.mockResolvedValue({
          id: 'pr1',
          repo: 'acme/app',
          number: 7,
          state: 'merged',
          headSha: HEAD,
        }),
      409,
      /is merged/,
    ],
    [
      'a stale head',
      () =>
        findPr.mockResolvedValue({
          id: 'pr1',
          repo: 'acme/app',
          number: 7,
          state: 'open',
          headSha: 'b'.repeat(40),
        }),
      409,
      /head is bbbbbbb.*push/i,
    ],
    [
      'an unconfirmed repository',
      () => confirmed.mockResolvedValue(() => null),
      409,
      /not confirmed/,
    ],
    [
      'scanning turned off',
      () => layers.mockResolvedValue({ scan: false }),
      409,
      /turned off/,
    ],
  ])(
    'refuses %s before storing anything',
    async (_name, arrange, status, message) => {
      arrange()
      await expect(
        securityAgentImportService.import(caller, body())
      ).rejects.toMatchObject({
        status,
        message: expect.stringMatching(message),
      })
      expect(put).not.toHaveBeenCalled()
      expect(startRun).not.toHaveBeenCalled()
    }
  )

  it('refuses a document that is not SARIF 2.1.0 (422) before storing it', async () => {
    await expect(
      securityAgentImportService.import(
        caller,
        body({ sarif: { version: '2.0.0', runs: [] } })
      )
    ).rejects.toMatchObject({ status: 422 })
    expect(put).not.toHaveBeenCalled()
  })

  it('passes the rate limit refusal through', async () => {
    rateLimit.mockRejectedValue(
      Object.assign(new Error('Rate limit exceeded'), { status: 429 })
    )
    await expect(
      securityAgentImportService.import(caller, body())
    ).rejects.toMatchObject({ status: 429 })
    expect(findPr).not.toHaveBeenCalled()
  })

  it('deletes the stored report and answers 503 when the ingest run cannot start', async () => {
    startRun.mockResolvedValue(null)
    await expect(
      securityAgentImportService.import(caller, body())
    ).rejects.toMatchObject({ status: 503 })
    expect(del).toHaveBeenCalledWith(
      expect.stringContaining('security-sarif/acme--app/')
    )
  })
})
