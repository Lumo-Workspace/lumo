/**
 * LUM-1318 — the `GitProvider` port: everything the PR scan / AI review does
 * to a repository or pull request, behind one object per Git platform.
 *
 * The scan and review services (`ee/security/services/**`) depend on this
 * port only — never on a platform's own client — and get the adapter for a
 * PR from `gitProviderFor(pr)` (`./resolve.ts`). A second platform is added
 * by writing an adapter and registering it there; the scan does not change.
 *
 * The data shapes are today's GitHub shapes (type-only references below —
 * no runtime dependency): an adapter for another platform maps its API's
 * answers into them, so the scan reads one vocabulary.
 *
 * Method arguments are the existing helpers' own option objects, 1:1, so the
 * GitHub adapter is a thin pass-through and its calls are unchanged.
 */
import type * as GithubContents from '@/lib/integrations/github/contents'
import type { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import type { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import type { TarReaderOptions } from '@/lib/integrations/github/tar-reader'
import type { GitProviderCapabilities } from './capabilities'
import type { GitProviderId } from './ids'

/** The data shapes the scan reads, re-exported so it never names a platform module. */
export type {
  ListedComment,
  ListedPullRequestFile,
  ListedReview,
} from '@/lib/integrations/github/pr-comment-client'
export type { ReviewThreadState } from '@/lib/integrations/github/review-threads'

/**
 * What a minted repository token may do — the purposes the scan asks for.
 * Each adapter maps a purpose to its platform's narrowest grant (GitHub:
 * `REPO_TOKEN_PERMISSIONS[purpose]`).
 */
export type RepoTokenPurpose =
  | 'contentsRead'
  | 'pullRequestRead'
  | 'pullRequestWrite'
  | 'reviewThreadWrite'
  | 'collaboratorPermission'

/** A platform API refusal: its HTTP status, and when a rate limit lifts. */
export interface GitApiError extends Error {
  status: number
  rateLimitResetAt?: Date
}

/** Incremental reader of the repository archive (`streamRepoTarballWithToken`'s chunks). */
export interface GitArchiveReader {
  push(chunk: Buffer): void
  /** True once the whole archive was read (and nothing was corrupt). */
  readonly done: boolean
}

/** Reads of a repository and its pull requests. */
export interface GitProviderReads {
  readRepoFile: typeof GithubContents.readRepoFile
  withRepoReadToken: typeof GithubContents.withRepoReadToken
  readRepoFileWithToken: typeof GithubContents.readRepoFileWithToken
  listRepoDirWithToken: typeof GithubContents.listRepoDirWithToken
  fetchPrDiff: typeof GithubContents.fetchPrDiff
  fetchPrChangedFiles: typeof GithubContents.fetchPrChangedFiles
  fetchPrCommitCount: typeof GithubContents.fetchPrCommitCount
  fetchReviewChangedPaths: typeof GithubContents.fetchReviewChangedPaths
  fetchCompareDiff: typeof GithubContents.fetchCompareDiff
  fetchPrFiles: typeof GithubContents.fetchPrFiles
  fetchPrHeadSha: typeof GithubContents.fetchPrHeadSha
  fetchPrBody: typeof GithubContents.fetchPrBody
  fetchPrBase: typeof GithubContents.fetchPrBase
  fetchPrDetails: typeof GithubContents.fetchPrDetails
  readPrTemplate: typeof GithubContents.readPrTemplate
  fetchDefaultBranchHead: typeof GithubContents.fetchDefaultBranchHead
  fetchRepoVisibility: typeof GithubContents.fetchRepoVisibility
  fetchRepoIssues: typeof GithubContents.fetchRepoIssues
  /** The added lines per file of a diff this provider returned. */
  addedLinesFromDiff(
    diff: string
  ): Promise<ReturnType<typeof GithubContents.addedLinesFromDiff>>
}

/** Code download: the archive (one request) and the sandbox clone token. */
export interface GitProviderCodeDownload {
  streamRepoTarballWithToken: typeof GithubContents.streamRepoTarballWithToken
  createArchiveReader(opts: TarReaderOptions): GitArchiveReader
  /** A one-repository, read-only token a sandbox clones with; revoke it after. */
  getRepoCloneToken(workspaceId: string, repository: string): Promise<string>
}

/** Writes on a pull request: comments, reviews, inline comments, verdict, description. */
export type GitCommentClient = Pick<
  typeof prCommentClient,
  | 'createIssueComment'
  | 'createReviewLineReply'
  | 'updateIssueComment'
  | 'updateReviewLineComment'
  | 'deleteIssueComment'
  | 'listIssueComments'
  | 'listIssueCommentsSince'
  | 'listReviewComments'
  | 'listReviewCommentsOfReview'
  | 'createReview'
  | 'submitReview'
  | 'listReviews'
  | 'dismissReview'
  | 'getPullRequestHead'
  | 'getPullRequestBody'
  | 'updatePullRequestBody'
  | 'listPullRequestFiles'
>

/** Review threads on a pull request. */
export type GitReviewThreadClient = Pick<
  typeof reviewThreadClient,
  'listReviewThreads' | 'resolveThread' | 'unresolveThread'
>

/** Which repositories the workspace let Lumo act on, and who may push. */
export interface GitProviderRepoGating {
  /** Pure: is `repository` on `confirmed` (the platform's own matching rules)? */
  isConfirmedRepository(
    confirmed: readonly string[],
    repository: string
  ): boolean
  /** A non-throwing checker over the workspace's confirmed list (canonical name or null). */
  loadConfirmedRepositories(
    workspaceId: string
  ): Promise<(repository: string) => string | null>
  /** The workspace's confirmed list as stored; null when the platform is not connected. */
  findConfirmedRepositories(workspaceId: string): Promise<string[] | null>
  checkRepositoryWriteAccess(
    token: string,
    repositoryFullName: string,
    login: string
  ): Promise<'write' | 'no_write' | 'unknown'>
}

/**
 * LUM-1318 — where a sandbox clones the repository from: a credential-free
 * HTTPS URL and the basic-auth username the clone token goes with. The
 * token itself is never part of it.
 */
export interface GitCloneSource {
  url: string
  username: string
}

/** LUM-1318 — the platform's web links the scan / review output carries. */
export interface GitProviderLinks {
  /** The commit page; null for a repository name or sha that is not safe to link. */
  commit(repository: string, sha: string): string | null
  /** A review (diff) comment on the pull request. */
  reviewComment(input: {
    repo: { owner: string; name: string }
    prNumber: number
    commentId: string
  }): string
}

export interface GitProvider
  extends GitProviderReads, GitProviderCodeDownload, GitProviderRepoGating {
  readonly id: GitProviderId
  readonly capabilities: GitProviderCapabilities
  /** A token for one confirmed repository, narrowed to `purpose`. */
  getRepoToken(
    workspaceId: string,
    repository: string,
    purpose: RepoTokenPurpose
  ): Promise<string>
  /** Revokes a token this provider minted. Never throws. */
  revokeToken(token: string): Promise<boolean>
  readonly comments: GitCommentClient
  readonly reviewThreads: GitReviewThreadClient
  /** Whether `error` is this platform's API refusal (has `status`). */
  isApiError(error: unknown): error is GitApiError
  /** Where a sandbox clones `repository` from (credential-free). */
  cloneSource(repository: string): GitCloneSource
  readonly links: GitProviderLinks
}
