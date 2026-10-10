/**
 * @jest-environment node
 */
/**
 * LUM-889 — the LUM-883 token tails: SARIF ingest for an unconfirmed
 * repository, PR-link case duplicates, Unicode case folding, and PRs of a
 * repository that left the confirmed list. The real confirmed-list check
 * (`confirmed-repositories.ts`) and token layer (`auth.ts`) run; only the
 * installation row, GitHub and the database are faked.
 *
 * LUM-1064: plugin half of __tests__/lum889-token-tails.test.ts (split)
 */
import { gzipSync } from 'node:zlib'

jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/lib/security-scan/workspace-switches')
      .resolveSecurityLayers(null),
}))
jest.mock('@/lib/services/security-sarif-blob', () => ({
  fetchPrivateBlob: jest.fn(),
  deleteBlob: jest.fn(),
  listSarifBlobs: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  readRepoFile: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findAllByRepoAndNumber: jest.fn(),
    findById: jest.fn(),
    findByRepoAndNumber: jest.fn(),
    updateTaskId: jest.fn(),
    updateState: jest.fn(),
    findManyForSecurityByTaskId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    markSarifIngested: jest.fn(),
    findSecurityBaseline: jest.fn(),
  },
}))
jest.mock('@/lib/repositories', () => ({
  projectRepository: {
    clearDefaultRepositories: jest.fn(),
    countRepositories: jest.fn().mockResolvedValue(0),
    createRepository: jest.fn(),
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
jest.mock('@/lib/services/security-managed-scan-start', () => ({
  startSecurityManagedScan: jest.fn(),
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn(), findById: jest.fn() },
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { findByTask: jest.fn().mockResolvedValue([]) },
}))
jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: { upsertPullRequest: jest.fn() },
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: {
    isRepoConfirmedElsewhere: jest.fn().mockResolvedValue(false),
  },
}))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: jest.fn(),
}))

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { fetchPrivateBlob } from '@/lib/services/security-sarif-blob'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { repoNotConfirmedError } from '@/lib/integrations/github/confirmed-repositories'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'

const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const createAppAuthMock = createAppAuth as unknown as jest.Mock
const ORIGINAL_FETCH = global.fetch
const ORIGINAL_ENV = process.env
let fetchMock: jest.Mock
let authFn: jest.Mock

function installation(repositories: string[], workspaceId = 'ws_1') {
  return {
    id: `gai_${workspaceId}`,
    workspaceId,
    installationId: 42,
    repositories,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    GITHUB_APP_PRIVATE_KEY: 'abc',
  }
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  authFn = jest.fn().mockResolvedValue({ token: 'ghs_' + 'repo' })
  createAppAuthMock.mockReturnValue(authFn)
  findByWorkspace.mockResolvedValue(installation(['acme/web']))
  ;(taskRepository.findWithProject as jest.Mock).mockResolvedValue({
    id: 'task_1',
    project: { workspaceId: 'ws_1' },
  })
})
afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  process.env = ORIGINAL_ENV
})

// ── 3. SARIF ────────────────────────────────────────────────────────────────

describe('LUM-889 SARIF ingest for an unconfirmed repository', () => {
  const JOB = {
    url: 'https://blob.vercel-storage.com/security-sarif/acme--payroll/sha1/semgrep.sarif.gz',
    pathname: 'security-sarif/acme--payroll/sha1/semgrep.sarif.gz',
    repository: 'acme/payroll',
    headSha: 'sha1',
    prNumber: 7,
    tool: 'semgrep',
  }
  const SARIF = {
    version: '2.1.0',
    runs: [
      { tool: { driver: { name: 'Semgrep OSS', rules: [] } }, results: [] },
    ],
  }
  const row = (workspaceId: string, repo = 'acme/payroll') => ({
    id: `pr_${workspaceId}`,
    workspaceId,
    taskId: null,
    repo,
    number: 7,
  })

  it('LUM-889 SARIF report for an unconfirmed repository creates no scan and is discarded as repo_not_confirmed', async () => {
    ;(
      pullRequestRepository.findAllByRepoAndNumber as jest.Mock
    ).mockResolvedValue([row('ws_1')])

    await expect(securitySarifIngestService.resolveScan(JOB)).resolves.toEqual({
      kind: 'discarded',
      reason: 'repo_not_confirmed',
    })
    expect(prSecurityScanRepository.createIfAbsent).not.toHaveBeenCalled()
    expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  })

  it('LUM-889 SARIF report lands only in the workspaces that confirmed the repository', async () => {
    ;(
      pullRequestRepository.findAllByRepoAndNumber as jest.Mock
    ).mockResolvedValue([row('ws_1'), row('ws_2')])
    findByWorkspace.mockImplementation(async (ws: string) =>
      ws === 'ws_2'
        ? installation(['Acme/Payroll'], 'ws_2')
        : installation(['acme/web'])
    )
    ;(prSecurityScanRepository.createIfAbsent as jest.Mock).mockResolvedValue({
      id: 'scan_2',
      created: true,
    })

    const outcome = await securitySarifIngestService.resolveScan(JOB)

    expect(outcome).toMatchObject({ kind: 'ok', scanId: 'scan_2' })
    expect(outcome).not.toHaveProperty('others')
    expect(prSecurityScanRepository.createIfAbsent).toHaveBeenCalledTimes(1)
    expect(prSecurityScanRepository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws_2' })
    )
  })

  it('LUM-889 SARIF diff refused mid-run as repo_not_confirmed is a deterministic failure with an accurate reason', async () => {
    ;(fetchPrivateBlob as jest.Mock).mockResolvedValue(
      gzipSync(JSON.stringify(SARIF))
    )
    // The real error the token layer throws once the repository left the list.
    ;(fetchPrDiff as jest.Mock).mockRejectedValue(
      repoNotConfirmedError('acme/payroll')
    )

    const outcome = await securitySarifIngestService.fetchAndNormalize({
      url: JOB.url,
      tool: 'semgrep',
      scanId: 'scan_1',
      pr: {
        id: 'pr_ws_1',
        workspaceId: 'ws_1',
        repo: 'acme/payroll',
        number: 7,
      },
    })

    // Returned, not thrown: the workflow step is not retried.
    expect(outcome).toMatchObject({ kind: 'failed' })
    const reason = (outcome as { reason: string }).reason
    expect(reason).toContain(
      "acme/payroll is not on this workspace's confirmed GitHub repositories"
    )
    expect(reason).not.toMatch(/GitHub API error/)
  })

  it('LUM-889 SARIF transient GitHub errors still propagate for a retry', async () => {
    ;(fetchPrivateBlob as jest.Mock).mockResolvedValue(
      gzipSync(JSON.stringify(SARIF))
    )
    ;(fetchPrDiff as jest.Mock).mockRejectedValue(
      Object.assign(new Error('GitHub API error 502'), { status: 502 })
    )
    await expect(
      securitySarifIngestService.fetchAndNormalize({
        url: JOB.url,
        tool: 'semgrep',
        scanId: 'scan_1',
        pr: { id: 'pr_ws_1', workspaceId: 'ws_1', repo: 'acme/web', number: 7 },
      })
    ).rejects.toMatchObject({ status: 502 })
  })
})

// ── 4. PR link case ─────────────────────────────────────────────────────────

// ── 5. canonical spelling / ASCII only ──────────────────────────────────────

// ── 6. PRs of a repository that left the list ───────────────────────────────
