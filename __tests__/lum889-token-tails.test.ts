/**
 * @jest-environment node
 */
/**
 * LUM-889 — the LUM-883 token tails: SARIF ingest for an unconfirmed
 * repository, PR-link case duplicates, Unicode case folding, and PRs of a
 * repository that left the confirmed list. The real confirmed-list check
 * (`confirmed-repositories.ts`) and token layer (`auth.ts`) run; only the
 * installation row, GitHub and the database are faked.
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
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
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
jest.mock('@/lib/repositories/idea-pull-request.repository', () => ({
  ideaPullRequestRepository: {
    findByIdeaAndPr: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'ipr_1' }),
  },
}))
jest.mock('@/lib/services/idea-evidence-resolve', () => ({
  resolveIdeaRef: jest
    .fn()
    .mockResolvedValue({ ideaId: 'idea_1', workspaceId: 'ws_1', teamId: 't' }),
}))
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  stampLineageInBackground: jest.fn(),
}))

import { createAppAuth } from '@octokit/auth-app'
import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { projectRepository } from '@/lib/repositories'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { fetchPrivateBlob } from '@/lib/services/security-sarif-blob'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import {
  canonicalConfirmedRepository,
  isConfirmedRepository,
  repoNotConfirmedError,
} from '@/lib/integrations/github/confirmed-repositories'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'
import { linkPullRequest } from '@/lib/services/task-pr-link.service'
import { ideaPullRequestService } from '@/lib/services/idea-pull-request.service'
import { projectRepositoryService } from '@/lib/services/project-repository.service'
import { syncPullRequestStatus } from '@/lib/services/task-pr-sync.service'
import { taskService } from '@/lib/services/task.service'

const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const createAppAuthMock = createAppAuth as unknown as jest.Mock
const ORIGINAL_FETCH = global.fetch
const ORIGINAL_ENV = process.env
let fetchMock: jest.Mock
let authFn: jest.Mock

/** U+212A KELVIN SIGN — `toLowerCase()` folds it onto ASCII `k`. */
const KELVIN = String.fromCharCode(0x212a)

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

describe('LUM-889 PR link case', () => {
  const ghPr = {
    number: 1,
    title: 'Fix',
    html_url: 'https://github.com/acme/app/pull/1',
    state: 'open',
    merged: false,
    draft: false,
    merged_at: null,
    closed_at: null,
    user: { login: 'dev' },
    head: { ref: 'fix', sha: 'abc' },
    base: { ref: 'main', repo: { full_name: 'acme/app' } },
  }
  const EXISTING = {
    id: 'pr_existing',
    workspaceId: 'ws_1',
    repo: 'acme/app',
    number: 1,
    taskId: null,
    task: null,
  }

  beforeEach(() => {
    findByWorkspace.mockResolvedValue(installation(['acme/app']))
    ;(
      pullRequestRepository.findByRepoAndNumber as jest.Mock
    ).mockImplementation(async (_ws: string, repo: string, number: number) =>
      repo === 'acme/app' && number === 1 ? EXISTING : null
    )
    ;(pullRequestRepository.updateTaskId as jest.Mock).mockImplementation(
      async (id: string, taskId: string) => ({ ...EXISTING, id, taskId })
    )
  })

  it('LUM-889 PR link case: a differently cased URL reuses the existing row on the task path', async () => {
    await linkPullRequest('task_1', {
      url: 'https://github.com/ACME/App/pull/1',
    })

    expect(pullRequestRepository.findByRepoAndNumber).toHaveBeenCalledWith(
      'ws_1',
      'acme/app',
      1
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(githubRepository.upsertPullRequest).not.toHaveBeenCalled()
    expect(pullRequestRepository.updateTaskId).toHaveBeenCalledWith(
      'pr_existing',
      'task_1'
    )
  })

  it('LUM-889 PR link case: a differently cased URL reuses the existing row on the idea path', async () => {
    await ideaPullRequestService.link({
      workspaceId: 'ws_1',
      ideaRef: 'LUM-I1',
      url: 'https://github.com/ACME/App/pull/1',
      createdById: 'm1',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(githubRepository.upsertPullRequest).not.toHaveBeenCalled()
  })

  it("LUM-889 PR link case: a new PR is stored under GitHub's canonical full_name", async () => {
    ;(pullRequestRepository.findByRepoAndNumber as jest.Mock).mockResolvedValue(
      null
    )
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ghPr,
    })
    ;(githubRepository.upsertPullRequest as jest.Mock).mockResolvedValue({
      id: 'pr_new',
      taskId: null,
    })

    await linkPullRequest('task_1', {
      url: 'https://github.com/ACME/App/pull/1',
    })
    await ideaPullRequestService.link({
      workspaceId: 'ws_1',
      ideaRef: 'LUM-I1',
      url: 'https://github.com/ACME/APP/pull/1',
      createdById: 'm1',
    })

    const upserts = (githubRepository.upsertPullRequest as jest.Mock).mock.calls
    expect(upserts).toHaveLength(2)
    for (const [data] of upserts) expect(data.repo).toBe('acme/app')
  })
})

// ── 5. canonical spelling / ASCII only ──────────────────────────────────────

describe('LUM-889 canonical repository', () => {
  it('LUM-889 canonical repository: a Kelvin-sign lookalike is not confirmed', () => {
    const lookalike = `acme/${KELVIN}ey`
    // The trap: JavaScript folds it onto the confirmed name.
    expect(lookalike.toLowerCase()).toBe('acme/key')
    expect(isConfirmedRepository(['acme/key'], lookalike)).toBe(false)
    expect(canonicalConfirmedRepository(['acme/key'], lookalike)).toBeNull()
    // ASCII case-insensitivity is unchanged.
    expect(canonicalConfirmedRepository(['Acme/Key'], 'ACME/KEY')).toBe(
      'Acme/Key'
    )
  })

  it('LUM-889 canonical repository: a Kelvin-sign lookalike cannot be added as a project repository', async () => {
    findByWorkspace.mockResolvedValue(installation(['acme/key']))
    await expect(
      projectRepositoryService.addRepository({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
        fullName: `acme/${KELVIN}ey`,
      })
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    expect(projectRepository.createRepository).not.toHaveBeenCalled()
  })

  it("LUM-889 canonical repository: a project repository is stored with the confirmed list's spelling", async () => {
    findByWorkspace.mockResolvedValue(installation(['Acme/Web']))
    await projectRepositoryService.addRepository({
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      fullName: 'acme/WEB',
    })
    expect(projectRepository.createRepository).toHaveBeenCalledWith({
      projectId: 'proj_1',
      fullName: 'Acme/Web',
      name: 'Web',
      isDefault: true,
    })
  })
})

// ── 6. PRs of a repository that left the list ───────────────────────────────

describe('LUM-889 removed repository PR', () => {
  const REMOVED = {
    id: 'pr_payroll',
    number: 7,
    url: 'https://github.com/acme/payroll/pull/7',
    state: 'open',
  }

  it('LUM-889 removed repository PR: the refresh skips it quietly and reports it as paused', async () => {
    const paused = new Set<string>()
    const updates = await syncPullRequestStatus('ws_1', [REMOVED], paused)

    expect(updates.size).toBe(0)
    expect([...paused]).toEqual(['pr_payroll'])
    expect(createAppAuthMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('LUM-889 removed repository PR: task detail marks it status-sync paused without warnings', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        state: 'open',
        merged: false,
        merged_at: null,
        closed_at: null,
        draft: false,
      }),
    })
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 'task_1',
      status: 'IN_PROGRESS',
      project: { workspaceId: 'ws_1' },
      team: { identifier: 'LUM', sprintsEnabled: false },
      parent: null,
      pullRequests: [
        { ...REMOVED, title: 'Payroll', ciStatus: null },
        {
          id: 'pr_web',
          number: 3,
          url: 'https://github.com/acme/web/pull/3',
          state: 'open',
          title: 'Web',
          ciStatus: null,
        },
      ],
    })

    const detail = await taskService.getTaskDetail('task_1')

    const byId = new Map(detail!.pullRequests.map(pr => [pr.id, pr]))
    expect(byId.get('pr_payroll')).toMatchObject({ statusSyncPaused: true })
    expect(byId.get('pr_web')).not.toHaveProperty('statusSyncPaused')
    expect(logger.warn).not.toHaveBeenCalled()
    // Only the confirmed repository was asked for a token.
    for (const call of authFn.mock.calls)
      expect(call[0].repositoryNames).toEqual(['web'])
  })
})
