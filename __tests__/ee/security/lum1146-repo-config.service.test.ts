/**
 * @jest-environment node
 *
 * LUM-1146 — the `.lumo.yaml` loader: cached per (workspace, repository,
 * commit sha), never throws, never caches a failed read; the effective
 * config of a repository with where each value came from.
 */
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(),
  fetchPrBase: jest.fn(),
  fetchDefaultBranchHead: jest.fn(),
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: { findSettings: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import {
  REPO_CONFIG_CACHE_MAX,
  clearRepoConfigCache,
  repoConfigService,
} from '@/ee/security/services/repo-config.service'
import * as gh from '@/lib/integrations/github/contents'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'

const read = gh.readRepoFile as jest.Mock
const fetchPrBase = gh.fetchPrBase as jest.Mock
const fetchDefaultBranchHead = gh.fetchDefaultBranchHead as jest.Mock
const findSettings = repoReviewSettingRepository.findSettings as jest.Mock

const SHA = 'a'.repeat(40)
const at = (sha = SHA, workspaceId = 'ws') =>
  repoConfigService.loadAt({ workspaceId, repo: 'Acme/App', sha })

beforeEach(() => {
  jest.clearAllMocks()
  clearRepoConfigCache()
})

describe('repoConfigService.loadAt', () => {
  it('reads the file at the commit and caches it per (workspace, repo, sha)', async () => {
    read.mockResolvedValue('reviews:\n  path_filters: ["!docs/**"]\n')
    const first = await at()
    expect(first).toEqual({
      status: 'loaded',
      config: { reviews: { path_filters: ['!docs/**'] } },
      unknownKeys: [],
    })
    expect(read).toHaveBeenCalledWith({
      workspaceId: 'ws',
      fullName: 'Acme/App',
      path: '.lumo.yaml',
      ref: SHA,
    })
    // Same commit (repo case differs): served from the cache.
    await repoConfigService.loadAt({
      workspaceId: 'ws',
      repo: 'acme/app',
      sha: SHA.toUpperCase(),
    })
    expect(read).toHaveBeenCalledTimes(1)
    // Another commit or another workspace reads again.
    await at('b'.repeat(40))
    await at(SHA, 'ws2')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('caches absent and invalid files too', async () => {
    read.mockResolvedValueOnce(null).mockResolvedValueOnce('version: 3\n')
    expect(await at()).toEqual({ status: 'absent' })
    expect(await at()).toEqual({ status: 'absent' })
    const other = 'c'.repeat(40)
    expect((await at(other)).status).toBe('invalid')
    expect((await at(other)).status).toBe('invalid')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('a failed read is "unreadable", never thrown and never cached', async () => {
    read.mockRejectedValueOnce(new Error('GitHub API error 502'))
    expect(await at()).toEqual({ status: 'unreadable' })
    read.mockResolvedValueOnce(null)
    expect(await at()).toEqual({ status: 'absent' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('a ref that is not a commit sha is never cached', async () => {
    read.mockResolvedValue(null)
    await at('main')
    await at('main')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('keeps at most REPO_CONFIG_CACHE_MAX entries (oldest evicted)', async () => {
    read.mockResolvedValue(null)
    const sha = (i: number) => i.toString(16).padStart(40, '0')
    for (let i = 0; i <= REPO_CONFIG_CACHE_MAX; i++) await at(sha(i))
    expect(read).toHaveBeenCalledTimes(REPO_CONFIG_CACHE_MAX + 1)
    await at(sha(REPO_CONFIG_CACHE_MAX))
    expect(read).toHaveBeenCalledTimes(REPO_CONFIG_CACHE_MAX + 1)
    await at(sha(0))
    expect(read).toHaveBeenCalledTimes(REPO_CONFIG_CACHE_MAX + 2)
  })
})

describe('repoConfigService.fileForDecision', () => {
  it('only a loaded base file is applied; no base sha = no read', async () => {
    expect(
      await repoConfigService.fileForDecision({
        workspaceId: 'ws',
        repo: 'Acme/App',
        baseSha: null,
      })
    ).toBeNull()
    expect(read).not.toHaveBeenCalled()
    read.mockResolvedValueOnce('reviews:\n  path_filters: 3\n')
    expect(
      await repoConfigService.fileForDecision({
        workspaceId: 'ws',
        repo: 'Acme/App',
        baseSha: SHA,
      })
    ).toBeNull()
    read.mockResolvedValueOnce('reviews: {}\n')
    expect(
      await repoConfigService.fileForDecision({
        workspaceId: 'ws',
        repo: 'Acme/App',
        baseSha: 'd'.repeat(40),
      })
    ).toEqual({ reviews: {} })
  })
})

describe('repoConfigService.forPullRequest', () => {
  const input = (diff = '') => ({
    workspaceId: 'ws',
    repo: 'Acme/App',
    prNumber: 9,
    headSha: 'e'.repeat(40),
    diff,
  })

  it('an unknown base is "unreadable" and applies nothing', async () => {
    fetchPrBase.mockRejectedValue(new Error('500'))
    expect(await repoConfigService.forPullRequest(input())).toEqual({
      file: null,
      notice: {
        baseRef: null,
        base: {
          status: 'unreadable',
          sha: null,
          problems: [],
          unknownKeys: [],
        },
        prBranch: null,
      },
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('reads the head copy only for a PR that changes the file', async () => {
    fetchPrBase.mockResolvedValue({ ref: 'main', sha: SHA })
    read.mockImplementation(async (o: { ref: string }) =>
      o.ref === SHA ? 'reviews: {}\n' : 'reviews: [\n'
    )
    const r = await repoConfigService.forPullRequest(
      input('diff --git a/.lumo.yaml b/.lumo.yaml\n')
    )
    expect(r.file).toEqual({ reviews: {} })
    expect(r.notice.base.status).toBe('loaded')
    expect(r.notice.prBranch).toEqual(
      expect.objectContaining({ status: 'invalid', sha: 'e'.repeat(40) })
    )
  })
})

describe('repoConfigService.effective', () => {
  it('reports each value and its source as of the default branch', async () => {
    fetchDefaultBranchHead.mockResolvedValue({ branch: 'main', sha: SHA })
    read.mockResolvedValue(
      'reviews:\n  auto_review:\n    ignore_title_keywords: [WIP]\n'
    )
    findSettings.mockResolvedValue([
      {
        workspaceId: 'ws',
        ...DEFAULT_REPO_REVIEW_SETTING,
        labels: ['review-me'],
      },
    ])
    const r = await repoConfigService.effective({
      workspaceId: 'ws',
      repo: 'Acme/App',
    })
    expect(findSettings).toHaveBeenCalledWith(['ws'], 'acme/app')
    expect(r.ref).toBe('main')
    expect(r.file).toEqual(
      expect.objectContaining({ status: 'loaded', sha: SHA })
    )
    expect(r.config.ignoreTitleKeywords).toEqual(
      expect.objectContaining({ value: ['WIP'], source: 'file' })
    )
    expect(r.config.labels).toEqual(
      expect.objectContaining({ value: ['review-me'], source: 'repository' })
    )
  })

  it('without a stored row, unset values are defaults', async () => {
    read.mockResolvedValue(null)
    findSettings.mockResolvedValue([])
    const r = await repoConfigService.effective({
      workspaceId: 'ws',
      repo: 'Acme/App',
      sha: SHA,
    })
    expect(fetchDefaultBranchHead).not.toHaveBeenCalled()
    expect(r.ref).toBeNull()
    expect(r.file.status).toBe('absent')
    expect(r.config.autoReview).toEqual(
      expect.objectContaining({ value: true, source: 'default' })
    )
  })
})
