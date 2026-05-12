import { lumoSyncService } from '@/lib/services/lumo-sync/lumo-sync.service'

const mockFindById = jest.fn()
const mockUpdateSyncResult = jest.fn()
const mockFindIntegration = jest.fn()
const mockFindRepositories = jest.fn()
const mockReadFile = jest.fn()
const mockCreateBranchWithFiles = jest.fn()
const mockCreatePullRequest = jest.fn()

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    findById: (...a: any[]) => mockFindById(...a),
    updateSyncResult: (...a: any[]) => mockUpdateSyncResult(...a),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegration: (...a: any[]) => mockFindIntegration(...a),
  },
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findRepositories: (...a: any[]) => mockFindRepositories(...a),
  },
}))

jest.mock('@/lib/services/lumo-sync/github-tree.service', () => ({
  githubTreeService: {
    readFile: (...a: any[]) => mockReadFile(...a),
    createBranchWithFiles: (...a: any[]) => mockCreateBranchWithFiles(...a),
    createPullRequest: (...a: any[]) => mockCreatePullRequest(...a),
  },
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: (s: string) => `decrypted-${s}`,
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForMemoryContext: jest.fn().mockResolvedValue({
      id: 'task-1',
      title: 'Fix auth',
      number: 42,
      projectId: 'proj-1',
      team: { identifier: 'LUM' },
    }),
  },
}))

beforeEach(() => jest.clearAllMocks())

const PROPOSAL = {
  id: 'prop-1',
  taskId: 'task-1',
  projectId: 'proj-1',
  status: 'PENDING',
  operations: [
    {
      type: 'add',
      section: 'Traps',
      content: 'SSO needs HTTPS',
      rationale: 'r',
      sourceTaskId: 'LUM-42',
    },
  ],
  summary: 'Added SSO trap',
}

const INTEGRATION = {
  id: 'int-1',
  workspaceId: 'ws-1',
  memberId: 'mem-1',
  accessToken: 'encrypted-token',
}

describe('lumoSyncService.sync', () => {
  it('happy path: reads proposal → applies → creates branch + PR → returns prUrl', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(INTEGRATION)
    mockFindRepositories.mockResolvedValueOnce([
      { fullName: 'org/repo', isDefault: true },
    ])
    mockReadFile.mockResolvedValueOnce(
      '# LUMO.md\n\n## Traps\n\n## Decisions\n'
    )
    mockCreateBranchWithFiles.mockResolvedValueOnce({
      branchName: 'lumo/sync-LUM-42-123',
      commitSha: 'sha-1',
    })
    mockCreatePullRequest.mockResolvedValueOnce({
      prUrl: 'https://github.com/org/repo/pull/1',
      prNumber: 1,
    })
    mockUpdateSyncResult.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')

    expect(result.prUrl).toBe('https://github.com/org/repo/pull/1')
    expect(result.prNumber).toBe(1)
    expect(mockCreateBranchWithFiles).toHaveBeenCalledWith(
      'org',
      'repo',
      'main',
      expect.stringContaining('lumo/sync-LUM-42'),
      expect.arrayContaining([expect.objectContaining({ path: 'LUMO.md' })]),
      expect.any(String),
      'decrypted-encrypted-token'
    )
    expect(mockUpdateSyncResult).toHaveBeenCalledWith(
      'prop-1',
      'APPLIED',
      expect.any(Date),
      'https://github.com/org/repo/pull/1'
    )
  })

  it('throws 404 when proposal not found', async () => {
    mockFindById.mockResolvedValueOnce(null)
    await expect(
      lumoSyncService.sync('missing', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when proposal is not PENDING', async () => {
    mockFindById.mockResolvedValueOnce({ ...PROPOSAL, status: 'APPLIED' })
    await expect(
      lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when GitHub not connected', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(null)
    await expect(
      lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when no repos linked', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(INTEGRATION)
    mockFindRepositories.mockResolvedValueOnce([])
    await expect(
      lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('includes CLAUDE.md in onboarding (LUMO.md not found)', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(INTEGRATION)
    mockFindRepositories.mockResolvedValueOnce([
      { fullName: 'org/repo', isDefault: true },
    ])
    // LUMO.md does not exist
    mockReadFile
      .mockResolvedValueOnce(null) // LUMO.md
      .mockResolvedValueOnce(null) // CLAUDE.md
    mockCreateBranchWithFiles.mockResolvedValueOnce({
      branchName: 'lumo/sync-LUM-42-123',
      commitSha: 'sha-1',
    })
    mockCreatePullRequest.mockResolvedValueOnce({
      prUrl: 'https://github.com/org/repo/pull/2',
      prNumber: 2,
    })
    mockUpdateSyncResult.mockResolvedValueOnce({ id: 'prop-1' })

    await lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')

    const filesArg = mockCreateBranchWithFiles.mock.calls[0][4] as {
      path: string
    }[]
    const paths = filesArg.map(f => f.path)
    expect(paths).toContain('LUMO.md')
    expect(paths).toContain('CLAUDE.md')
  })
})
