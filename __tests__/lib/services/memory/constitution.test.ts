/**
 * @jest-environment node
 *
 * LUM-778 — the memory constitution is the CUSTOMER's CLAUDE.md / AGENTS.md,
 * read from the project's default linked GitHub repo (the same
 * `readRepoFile({ workspaceId, fullName })` source the policy compiler uses),
 * never the file that happens to sit in the server process's cwd. Every
 * failure to reach the customer's files degrades to null so the redundancy
 * gate stays fail-open.
 */
const mockFindDefaultRepository = jest.fn()
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findDefaultRepository: (...a: unknown[]) =>
      mockFindDefaultRepository(...(a as [string])),
  },
}))
const mockReadRepoFile = jest.fn()
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: (...a: unknown[]) => mockReadRepoFile(...(a as [unknown])),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import {
  loadConstitution,
  loadConstitutionText,
  resetConstitutionCache,
} from '@/lib/services/memory/constitution'

const SCOPE = { projectId: 'proj-1', workspaceId: 'ws-1' }

beforeEach(() => {
  jest.clearAllMocks()
  resetConstitutionCache()
  mockFindDefaultRepository.mockResolvedValue({ fullName: 'acme/app' })
})

describe('loadConstitution (LUM-778)', () => {
  it('reads the project default repo through readRepoFile with the workspace id — never process.cwd()', async () => {
    mockReadRepoFile.mockImplementation(async (opts: { path: string }) =>
      opts.path === 'CLAUDE.md'
        ? '\n# Acme rules\n- no raw SQL\n\n'
        : '  # Agents  '
    )

    const result = await loadConstitution(SCOPE)

    expect(mockFindDefaultRepository).toHaveBeenCalledWith('proj-1')
    expect(mockReadRepoFile).toHaveBeenCalledTimes(2)
    expect(mockReadRepoFile).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fullName: 'acme/app',
      path: 'CLAUDE.md',
    })
    expect(mockReadRepoFile).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      fullName: 'acme/app',
      path: 'AGENTS.md',
    })
    expect(result).toEqual({
      claudeMd: '# Acme rules\n- no raw SQL',
      agentsMd: '# Agents',
      repo: 'acme/app',
    })
  })

  it('reads the project default repo once per TTL window (per-project cache)', async () => {
    mockReadRepoFile.mockResolvedValue('rule')
    await loadConstitution(SCOPE)
    await loadConstitution(SCOPE)
    await loadConstitution({ projectId: 'proj-2', workspaceId: 'ws-1' })
    expect(mockFindDefaultRepository).toHaveBeenCalledTimes(2)
    expect(mockReadRepoFile).toHaveBeenCalledTimes(4)
  })

  it('combines both files into one text and names the repo they came from', async () => {
    mockReadRepoFile.mockImplementation(async (opts: { path: string }) =>
      opts.path === 'CLAUDE.md' ? 'claude rule' : 'agents rule'
    )
    await expect(loadConstitutionText(SCOPE)).resolves.toBe(
      'claude rule\n\nagents rule'
    )
  })

  describe('fail-open: the gate can never reject because the customer files are unreachable', () => {
    it('fail-open when the project has no linked repository', async () => {
      mockFindDefaultRepository.mockResolvedValue(null)
      await expect(loadConstitution(SCOPE)).resolves.toEqual({
        claudeMd: null,
        agentsMd: null,
        repo: null,
      })
      await expect(loadConstitutionText(SCOPE)).resolves.toBeNull()
      expect(mockReadRepoFile).not.toHaveBeenCalled()
    })

    it('fail-open when the workspace has no GitHub installation (token resolution throws)', async () => {
      mockReadRepoFile.mockRejectedValue(
        new Error('No GitHubAppInstallation for workspace')
      )
      await expect(loadConstitution(SCOPE)).resolves.toEqual({
        claudeMd: null,
        agentsMd: null,
        repo: 'acme/app',
      })
      await expect(loadConstitutionText(SCOPE)).resolves.toBeNull()
    })

    it('fail-open when the GitHub read fails for one file only', async () => {
      mockReadRepoFile.mockImplementation(async (opts: { path: string }) => {
        if (opts.path === 'CLAUDE.md') return 'present'
        throw Object.assign(new Error('GitHub API error 500'), { status: 500 })
      })
      await expect(loadConstitution(SCOPE)).resolves.toEqual({
        claudeMd: 'present',
        agentsMd: null,
        repo: 'acme/app',
      })
    })

    it('fail-open when both files are absent (404 → null) or whitespace-only', async () => {
      mockReadRepoFile.mockResolvedValue(null)
      await expect(loadConstitutionText(SCOPE)).resolves.toBeNull()

      resetConstitutionCache()
      mockReadRepoFile.mockResolvedValue('   \n  \n')
      await expect(loadConstitution(SCOPE)).resolves.toEqual({
        claudeMd: null,
        agentsMd: null,
        repo: 'acme/app',
      })
    })

    it('fail-open when the repository lookup itself throws', async () => {
      mockFindDefaultRepository.mockRejectedValue(new Error('db down'))
      await expect(loadConstitutionText(SCOPE)).resolves.toBeNull()
    })
  })
})
