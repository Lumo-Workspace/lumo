/**
 * LUM-1318 — the GitHub adapter of the GitProvider port forwards every call
 * 1:1 to the existing `lib/integrations/github` helper, arguments unchanged.
 */
jest.mock('@/lib/integrations/github/contents', () => ({
  readRepoFile: jest.fn(),
  withRepoReadToken: jest.fn(),
  readRepoFileWithToken: jest.fn(),
  listRepoDirWithToken: jest.fn(),
  fetchPrDiff: jest.fn(),
  fetchPrChangedFiles: jest.fn(),
  fetchPrCommitCount: jest.fn(),
  fetchReviewChangedPaths: jest.fn(),
  fetchCompareDiff: jest.fn(),
  fetchPrFiles: jest.fn(),
  fetchPrHeadSha: jest.fn(),
  fetchPrBody: jest.fn(),
  fetchPrBase: jest.fn(),
  fetchPrDetails: jest.fn(),
  readPrTemplate: jest.fn(),
  fetchDefaultBranchHead: jest.fn(),
  fetchRepoVisibility: jest.fn(),
  fetchRepoIssues: jest.fn(),
  addedLinesFromDiff: jest.fn(),
  streamRepoTarballWithToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/confirmed-repositories', () => ({
  isConfirmedRepository: jest.fn(),
  loadConfirmedRepositories: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  class GithubApiError extends Error {
    constructor(public status: number) {
      super(`GitHub API error ${status}`)
    }
  }
  return {
    GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      createReviewLineReply: jest.fn(),
      updateIssueComment: jest.fn(),
      updateReviewLineComment: jest.fn(),
      deleteIssueComment: jest.fn(),
      listIssueComments: jest.fn(),
      listIssueCommentsSince: jest.fn(),
      listReviewComments: jest.fn(),
      listReviewCommentsOfReview: jest.fn(),
      createReview: jest.fn(),
      submitReview: jest.fn(),
      listReviews: jest.fn(),
      dismissReview: jest.fn(),
      getPullRequestHead: jest.fn(),
      getPullRequestBody: jest.fn(),
      updatePullRequestBody: jest.fn(),
      listPullRequestFiles: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn(),
    resolveThread: jest.fn(),
    unresolveThread: jest.fn(),
  },
}))

import * as contents from '@/lib/integrations/github/contents'
import * as auth from '@/lib/integrations/github/auth'
import * as collaborator from '@/lib/integrations/github/collaborator-access'
import * as confirmed from '@/lib/integrations/github/confirmed-repositories'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import {
  GithubApiError,
  prCommentClient,
} from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { TarReader } from '@/lib/integrations/github/tar-reader'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { githubGitProvider } from '@/lib/integrations/git-provider/github'
import {
  GIT_PROVIDER_CAPABILITIES,
  GITHUB_PROVIDER,
} from '@/lib/integrations/git-provider'

const mocked = <T>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('GitHub adapter — identity', () => {
  it('is the github provider and declares every capability', () => {
    expect(githubGitProvider.id).toBe(GITHUB_PROVIDER)
    for (const capability of GIT_PROVIDER_CAPABILITIES)
      expect(githubGitProvider.capabilities[capability]).toBe(true)
  })
})

describe('GitHub adapter — reads delegate to contents.ts 1:1', () => {
  const opts = { workspaceId: 'ws', fullName: 'o/r', prNumber: 7 }
  const methods = [
    'readRepoFile',
    'readRepoFileWithToken',
    'listRepoDirWithToken',
    'fetchPrDiff',
    'fetchPrChangedFiles',
    'fetchPrCommitCount',
    'fetchReviewChangedPaths',
    'fetchCompareDiff',
    'fetchPrFiles',
    'fetchPrHeadSha',
    'fetchPrBody',
    'fetchPrBase',
    'fetchPrDetails',
    'readPrTemplate',
    'fetchDefaultBranchHead',
    'fetchRepoVisibility',
    'fetchRepoIssues',
    'streamRepoTarballWithToken',
  ] as const
  it.each(methods)('%s', async name => {
    const result = { from: name }
    mocked(contents[name]).mockResolvedValue(result)
    const call = githubGitProvider[name] as (o: unknown) => Promise<unknown>
    await expect(call(opts)).resolves.toBe(result)
    expect(contents[name]).toHaveBeenCalledTimes(1)
    expect(contents[name]).toHaveBeenCalledWith(opts)
  })

  it('withRepoReadToken passes the options and the callback', async () => {
    mocked(contents.withRepoReadToken).mockResolvedValue('done')
    const fn = jest.fn()
    await expect(
      githubGitProvider.withRepoReadToken(
        { workspaceId: 'ws', fullName: 'o/r' },
        fn
      )
    ).resolves.toBe('done')
    expect(contents.withRepoReadToken).toHaveBeenCalledWith(
      { workspaceId: 'ws', fullName: 'o/r' },
      fn
    )
  })

  it('addedLinesFromDiff parses with the GitHub helper', async () => {
    const out = [{ path: 'a.ts', addedLines: ['x'] }]
    mocked(contents.addedLinesFromDiff).mockReturnValue(out)
    await expect(githubGitProvider.addedLinesFromDiff('diff')).resolves.toBe(
      out
    )
    expect(contents.addedLinesFromDiff).toHaveBeenCalledWith('diff')
  })
})

describe('GitHub adapter — tokens', () => {
  it.each([
    'contentsRead',
    'pullRequestRead',
    'pullRequestWrite',
    'reviewThreadWrite',
    'collaboratorPermission',
  ] as const)(
    'getRepoToken(%s) mints with REPO_TOKEN_PERMISSIONS[purpose]',
    async purpose => {
      mocked(auth.getRepoToken).mockResolvedValue('tok')
      await expect(
        githubGitProvider.getRepoToken('ws', 'o/r', purpose)
      ).resolves.toBe('tok')
      expect(auth.getRepoToken).toHaveBeenCalledWith(
        'ws',
        'o/r',
        REPO_TOKEN_PERMISSIONS[purpose]
      )
    }
  )

  it('getRepoCloneToken and revokeToken delegate to auth.ts', async () => {
    mocked(auth.getRepoCloneToken).mockResolvedValue('clone')
    mocked(auth.revokeInstallationToken).mockResolvedValue(true)
    await expect(
      githubGitProvider.getRepoCloneToken('ws', 'o/r')
    ).resolves.toBe('clone')
    expect(auth.getRepoCloneToken).toHaveBeenCalledWith('ws', 'o/r')
    await expect(githubGitProvider.revokeToken('clone')).resolves.toBe(true)
    expect(auth.revokeInstallationToken).toHaveBeenCalledWith('clone')
  })
})

describe('GitHub adapter — code download', () => {
  it('createArchiveReader is a TarReader over the same options', () => {
    const reader = githubGitProvider.createArchiveReader({
      wantPath: () => true,
      maxFileBytes: 10,
      onFile: () => undefined,
    })
    expect(reader).toBeInstanceOf(TarReader)
    expect(reader.done).toBe(false)
  })
})

describe('GitHub adapter — comment and thread clients', () => {
  const commentMethods = Object.keys(githubGitProvider.comments) as Array<
    keyof typeof githubGitProvider.comments
  >
  it('wraps every port comment method', () => {
    expect(commentMethods).toHaveLength(17)
  })
  it.each(commentMethods)(
    'comments.%s delegates to prCommentClient',
    async name => {
      const input = { token: 't', repo: { owner: 'o', name: 'r' }, prNumber: 1 }
      mocked(prCommentClient[name]).mockResolvedValue({ from: name })
      const call = githubGitProvider.comments[name] as (
        i: unknown
      ) => Promise<unknown>
      await expect(call(input)).resolves.toEqual({ from: name })
      expect(prCommentClient[name]).toHaveBeenCalledWith(input)
    }
  )
  it.each(['listReviewThreads', 'resolveThread', 'unresolveThread'] as const)(
    'reviewThreads.%s delegates to reviewThreadClient',
    async name => {
      const input = { threadId: 'T', token: 't' }
      mocked(reviewThreadClient[name]).mockResolvedValue([])
      const call = githubGitProvider.reviewThreads[name] as (
        i: unknown
      ) => Promise<unknown>
      await call(input)
      expect(reviewThreadClient[name]).toHaveBeenCalledWith(input)
    }
  )
  it('isApiError recognises GithubApiError only', () => {
    expect(githubGitProvider.isApiError(new GithubApiError(404, null))).toBe(
      true
    )
    expect(githubGitProvider.isApiError(new Error('x'))).toBe(false)
    expect(githubGitProvider.isApiError({ status: 404 })).toBe(false)
  })
})

describe('GitHub adapter — repository gating', () => {
  it('isConfirmedRepository / loadConfirmedRepositories delegate', async () => {
    mocked(confirmed.isConfirmedRepository).mockReturnValue(true)
    expect(githubGitProvider.isConfirmedRepository(['o/r'], 'O/R')).toBe(true)
    expect(confirmed.isConfirmedRepository).toHaveBeenCalledWith(['o/r'], 'O/R')
    const checker = jest.fn()
    mocked(confirmed.loadConfirmedRepositories).mockResolvedValue(checker)
    await expect(
      githubGitProvider.loadConfirmedRepositories('ws')
    ).resolves.toBe(checker)
    expect(confirmed.loadConfirmedRepositories).toHaveBeenCalledWith('ws')
  })

  it('findConfirmedRepositories reads the installation (null when none)', async () => {
    mocked(
      githubAppInstallationRepository.findByWorkspace
    ).mockResolvedValueOnce({
      repositories: ['o/r'],
    })
    await expect(
      githubGitProvider.findConfirmedRepositories('ws')
    ).resolves.toEqual(['o/r'])
    mocked(
      githubAppInstallationRepository.findByWorkspace
    ).mockResolvedValueOnce(null)
    await expect(
      githubGitProvider.findConfirmedRepositories('ws')
    ).resolves.toBeNull()
    expect(
      githubAppInstallationRepository.findByWorkspace
    ).toHaveBeenCalledWith('ws')
  })

  it('checkRepositoryWriteAccess delegates to collaborator-access.ts', async () => {
    mocked(collaborator.checkRepositoryWriteAccess).mockResolvedValue('write')
    await expect(
      githubGitProvider.checkRepositoryWriteAccess('t', 'o/r', 'alice')
    ).resolves.toBe('write')
    expect(collaborator.checkRepositoryWriteAccess).toHaveBeenCalledWith(
      't',
      'o/r',
      'alice'
    )
  })
})
