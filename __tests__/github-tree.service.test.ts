import { githubTreeService } from '@/lib/services/lumo-sync/github-tree.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => jest.clearAllMocks())

describe('githubTreeService.readFile', () => {
  it('returns decoded content when file exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from('# LUMO.md\n').toString('base64'),
        encoding: 'base64',
      }),
    })

    const result = await githubTreeService.readFile(
      'owner',
      'repo',
      'LUMO.md',
      'token-123'
    )

    expect(result).toBe('# LUMO.md\n')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/contents/LUMO.md',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    )
  })

  it('returns null when file does not exist (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await githubTreeService.readFile(
      'owner',
      'repo',
      'LUMO.md',
      'token-123'
    )
    expect(result).toBeNull()
  })

  it('throws on non-404 errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    })
    await expect(
      githubTreeService.readFile('owner', 'repo', 'LUMO.md', 'token-123')
    ).rejects.toThrow()
  })
})

describe('githubTreeService.createBranchWithFiles', () => {
  it('creates branch with files via Git Data API', async () => {
    // Step 1: get base ref
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ object: { sha: 'base-sha' } }),
    })
    // Step 2: get base commit to find tree sha
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: { sha: 'base-tree-sha' } }),
    })
    // Step 3: create blob (one file)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'blob-sha-1' }),
    })
    // Step 4: create tree
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'new-tree-sha' }),
    })
    // Step 5: create commit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'new-commit-sha' }),
    })
    // Step 6: create ref
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ref: 'refs/heads/lumo/sync-LUM-42-123' }),
    })

    const result = await githubTreeService.createBranchWithFiles(
      'owner',
      'repo',
      'main',
      'lumo/sync-LUM-42-123',
      [{ path: 'LUMO.md', content: '# LUMO.md\n- trap' }],
      'chore: sync LUMO.md',
      'token-123'
    )

    expect(result).toEqual({
      branchName: 'lumo/sync-LUM-42-123',
      commitSha: 'new-commit-sha',
    })
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })
})

describe('githubTreeService.createPullRequest', () => {
  it('creates PR and returns url + number', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        html_url: 'https://github.com/owner/repo/pull/42',
        number: 42,
      }),
    })

    const result = await githubTreeService.createPullRequest(
      'owner',
      'repo',
      'title',
      'body',
      'lumo/sync',
      'main',
      'token-123'
    )

    expect(result).toEqual({
      prUrl: 'https://github.com/owner/repo/pull/42',
      prNumber: 42,
    })
  })
})
