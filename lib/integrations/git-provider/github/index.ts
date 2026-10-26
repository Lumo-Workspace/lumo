/**
 * LUM-1318 — the GitHub adapter of the `GitProvider` port: a thin, 1:1
 * pass-through to the existing `lib/integrations/github` helpers. Every
 * method forwards its arguments unchanged and looks the helper up at call
 * time, so behavior (and every test that mocks a GitHub module) is the same
 * as calling the helper directly.
 *
 * `contents`, `auth` and `collaborator-access` are imported lazily: they
 * pull in `@octokit/auth-app` (ESM), which scan modules kept out of their
 * static graph on purpose (see `review-context.service.ts`), and a path that
 * never reads a repository must not load the token minting behind them.
 */
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { TarReader } from '@/lib/integrations/github/tar-reader'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import {
  isConfirmedRepository,
  loadConfirmedRepositories,
} from '@/lib/integrations/github/confirmed-repositories'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { allCapabilities } from '../capabilities'
import { GITHUB_PROVIDER } from '../ids'
import type {
  GitApiError,
  GitCommentClient,
  GitProvider,
  GitReviewThreadClient,
} from '../types'

function contents() {
  return import('@/lib/integrations/github/contents')
}

function auth() {
  return import('@/lib/integrations/github/auth')
}

const comments: GitCommentClient = {
  createIssueComment: input => prCommentClient.createIssueComment(input),
  createReviewLineReply: input => prCommentClient.createReviewLineReply(input),
  updateIssueComment: input => prCommentClient.updateIssueComment(input),
  updateReviewLineComment: input =>
    prCommentClient.updateReviewLineComment(input),
  deleteIssueComment: input => prCommentClient.deleteIssueComment(input),
  listIssueComments: input => prCommentClient.listIssueComments(input),
  listIssueCommentsSince: input =>
    prCommentClient.listIssueCommentsSince(input),
  listReviewComments: input => prCommentClient.listReviewComments(input),
  listReviewCommentsOfReview: input =>
    prCommentClient.listReviewCommentsOfReview(input),
  createReview: input => prCommentClient.createReview(input),
  submitReview: input => prCommentClient.submitReview(input),
  listReviews: input => prCommentClient.listReviews(input),
  dismissReview: input => prCommentClient.dismissReview(input),
  getPullRequestHead: input => prCommentClient.getPullRequestHead(input),
  getPullRequestBody: input => prCommentClient.getPullRequestBody(input),
  updatePullRequestBody: input => prCommentClient.updatePullRequestBody(input),
  listPullRequestFiles: input => prCommentClient.listPullRequestFiles(input),
}

const reviewThreads: GitReviewThreadClient = {
  listReviewThreads: input => reviewThreadClient.listReviewThreads(input),
  resolveThread: input => reviewThreadClient.resolveThread(input),
  unresolveThread: input => reviewThreadClient.unresolveThread(input),
}

export const githubGitProvider: GitProvider = {
  id: GITHUB_PROVIDER,
  capabilities: allCapabilities(),

  // ── tokens ────────────────────────────────────────────────────────────
  async getRepoToken(workspaceId, repository, purpose) {
    return (await auth()).getRepoToken(
      workspaceId,
      repository,
      REPO_TOKEN_PERMISSIONS[purpose]
    )
  },
  async revokeToken(token) {
    return (await auth()).revokeInstallationToken(token)
  },

  // ── reads ─────────────────────────────────────────────────────────────
  async readRepoFile(opts) {
    return (await contents()).readRepoFile(opts)
  },
  async withRepoReadToken(opts, fn) {
    return (await contents()).withRepoReadToken(opts, fn)
  },
  async readRepoFileWithToken(opts) {
    return (await contents()).readRepoFileWithToken(opts)
  },
  async listRepoDirWithToken(opts) {
    return (await contents()).listRepoDirWithToken(opts)
  },
  async fetchPrDiff(opts) {
    return (await contents()).fetchPrDiff(opts)
  },
  async fetchPrChangedFiles(opts) {
    return (await contents()).fetchPrChangedFiles(opts)
  },
  async fetchPrCommitCount(opts) {
    return (await contents()).fetchPrCommitCount(opts)
  },
  async fetchReviewChangedPaths(opts) {
    return (await contents()).fetchReviewChangedPaths(opts)
  },
  async fetchCompareDiff(opts) {
    return (await contents()).fetchCompareDiff(opts)
  },
  async fetchPrFiles(opts) {
    return (await contents()).fetchPrFiles(opts)
  },
  async fetchPrHeadSha(opts) {
    return (await contents()).fetchPrHeadSha(opts)
  },
  async fetchPrBody(opts) {
    return (await contents()).fetchPrBody(opts)
  },
  async fetchPrBase(opts) {
    return (await contents()).fetchPrBase(opts)
  },
  async fetchPrDetails(opts) {
    return (await contents()).fetchPrDetails(opts)
  },
  async readPrTemplate(opts) {
    return (await contents()).readPrTemplate(opts)
  },
  async fetchDefaultBranchHead(opts) {
    return (await contents()).fetchDefaultBranchHead(opts)
  },
  async fetchRepoVisibility(opts) {
    return (await contents()).fetchRepoVisibility(opts)
  },
  async fetchRepoIssues(opts) {
    return (await contents()).fetchRepoIssues(opts)
  },
  async addedLinesFromDiff(diff) {
    return (await contents()).addedLinesFromDiff(diff)
  },

  // ── code download ─────────────────────────────────────────────────────
  async streamRepoTarballWithToken(opts) {
    return (await contents()).streamRepoTarballWithToken(opts)
  },
  createArchiveReader(opts) {
    return new TarReader(opts)
  },
  async getRepoCloneToken(workspaceId, repository) {
    return (await auth()).getRepoCloneToken(workspaceId, repository)
  },

  // ── writes ────────────────────────────────────────────────────────────
  comments,
  reviewThreads,
  isApiError(error): error is GitApiError {
    return error instanceof GithubApiError
  },

  // ── repository gating ─────────────────────────────────────────────────
  isConfirmedRepository(confirmed, repository) {
    return isConfirmedRepository(confirmed, repository)
  },
  loadConfirmedRepositories(workspaceId) {
    return loadConfirmedRepositories(workspaceId)
  },
  async findConfirmedRepositories(workspaceId) {
    const installation =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    return installation ? installation.repositories : null
  },
  async checkRepositoryWriteAccess(token, repositoryFullName, login) {
    const { checkRepositoryWriteAccess } =
      await import('@/lib/integrations/github/collaborator-access')
    return checkRepositoryWriteAccess(token, repositoryFullName, login)
  },
}
