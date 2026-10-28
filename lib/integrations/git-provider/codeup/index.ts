/**
 * LUM-1316 — the Codeup (Alibaba Cloud Yunxiao, center edition) adapter of
 * the `GitProvider` port, so the one scan / AI review runs on Codeup merge
 * requests. Codeup's answers are mapped into the port's shapes:
 *
 * - head = the newest `MERGE_SOURCE` version of the merge request, base =
 *   the newest `MERGE_TARGET` version (ListChangeRequestPatchSets); the diff
 *   is GetCompare(base → head) rebuilt as a git unified diff;
 * - the summary is a global comment, updated in place by its id; each
 *   inline finding is an inline comment on the head version;
 * - every call runs as the connection's personal access token owner — Codeup
 *   has no app identity (the settings copy recommends a service account).
 *
 * Capabilities are declared honestly: what Codeup lacks or this adapter
 * does not map yet is `false`, the scan skips those layers / write-backs,
 * and the matching methods refuse with 501 instead of guessing.
 *
 * Behind `codeup-integration`: a repository token is only minted for a
 * workspace in the rollout, with Codeup connected and the repository
 * confirmed — the same gate the GitHub token mint applies.
 */
import { decrypt } from '@/lib/crypto'
import { isFeatureEnabled } from '@/lib/features/is-enabled'
import {
  CodeupApiError,
  createCodeupClient,
  type CodeupClient,
  type CodeupComment,
  type CodeupMergeRequestRef,
  type CodeupPatchSet,
} from '@/lib/integrations/codeup/client'
import { toChangedFiles, toUnifiedDiff } from '@/lib/integrations/codeup/diff'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import { addedLinesWithNumbers } from '@/lib/diff/diff-lines'
import { CODEUP_PROVIDER } from '../ids'
import type { GitProviderCapabilities } from '../capabilities'
import type {
  GitApiError,
  GitCommentClient,
  GitProvider,
  GitReviewThreadClient,
  ListedComment,
} from '../types'
import {
  decodeCodeupCredential,
  decodeCommentId,
  encodeCodeupCredential,
  encodeCommentId,
} from './credential'

/** Codeup's web host (center edition) — commit / merge request links. */
export const CODEUP_WEB_BASE = 'https://codeup.aliyun.com'

/**
 * What this adapter can do beyond the core (diff, head, comments).
 * - repoClone / repoArchive: the sandbox layers come with LUM-1317.
 * - prFileList: yes — GetCompare lists each file with its hunks.
 * - reviewThreads: Codeup comments are only resolved / unresolved by hand;
 *   Lumo's thread lifecycle (resolve on fix, reopen on regression) is not
 *   mapped, and Lumo cannot tell its own comments from the token owner's.
 * - reviewVerdict: Codeup's review opinion (PASS / NOT_PASS) would be the
 *   token owner's personal approval — never given on Lumo's behalf.
 * - descriptionWrite: the description is the author's; not written.
 * - repoIssues: Codeup has no repository issues.
 * - collaboratorAccess: no per-user push permission lookup is mapped
 *   (needed only by PR commands, not offered on Codeup).
 */
export const CODEUP_CAPABILITIES: GitProviderCapabilities = Object.freeze({
  repoClone: false,
  repoArchive: false,
  prFileList: true,
  reviewThreads: false,
  reviewVerdict: false,
  descriptionWrite: false,
  repoIssues: false,
  collaboratorAccess: false,
})

/** The refusal of a call whose capability Codeup does not declare. */
export function unsupportedOnCodeup(operation: string): CodeupApiError {
  return new CodeupApiError(501, `${operation} is not supported on Codeup`)
}

/** Codeup's merge request status in the port's PR states. */
export function prStateOf(status: string): 'open' | 'closed' | 'merged' {
  if (status === 'MERGED') return 'merged'
  if (status === 'CLOSED') return 'closed'
  return 'open'
}

/** The newest version of each side; null when Codeup lists none. */
export function latestVersions(patchSets: readonly CodeupPatchSet[]): {
  head: CodeupPatchSet | null
  base: CodeupPatchSet | null
} {
  const newest = (type: string) =>
    patchSets
      .filter(p => p.relatedMergeItemType === type)
      .reduce<CodeupPatchSet | null>(
        (best, p) => (!best || p.versionNo > best.versionNo ? p : best),
        null
      )
  return { head: newest('MERGE_SOURCE'), base: newest('MERGE_TARGET') }
}

/** A Codeup comment as the port's listed comment: its body is what the scan reads. */
export function toListedComment(c: CodeupComment): ListedComment {
  // No numeric id and no bot identity on Codeup: the scan reads these only
  // for the fingerprint markers in their bodies (its id- and author-keyed
  // paths need reviewThreads / an App identity, which Codeup does not have).
  return {
    id: 0,
    node_id: c.commentBizId,
    html_url: '',
    body: c.content,
    updated_at: c.commentTime ?? '',
    user: null,
  }
}

function clientFor(credential: string): CodeupClient {
  const { organizationId, token } = decodeCodeupCredential(credential)
  return createCodeupClient(organizationId, token)
}

/** The port splits `org/group/repo` at its last slash; join it back. */
function repositoryOf(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`
}

function mrRef(repository: string, localId: number): CodeupMergeRequestRef {
  return { repository, localId }
}

async function versionsOf(
  client: CodeupClient,
  ref: CodeupMergeRequestRef
): Promise<{ head: CodeupPatchSet; base: CodeupPatchSet }> {
  const { head, base } = latestVersions(await client.listPatchSets(ref))
  if (!head || !base)
    throw new CodeupApiError(502, 'Codeup listed no merge request versions')
  return { head, base }
}

async function compareOf(client: CodeupClient, ref: CodeupMergeRequestRef) {
  const { head, base } = await versionsOf(client, ref)
  return {
    head,
    compare: await client.compare(ref.repository, base.commitId, head.commitId),
  }
}

async function confirmedPaths(workspaceId: string): Promise<string[] | null> {
  const connection =
    await codeupRepository.findConnectionByWorkspace(workspaceId)
  if (!connection) return null
  return connection.repositories
    .filter(r => r.confirmedAt !== null)
    .map(r => r.pathWithNamespace)
}

async function getRepoToken(
  workspaceId: string,
  repository: string
): Promise<string> {
  if (!isFeatureEnabled('codeup-integration', workspaceId))
    throw new CodeupApiError(404, 'Codeup is not enabled for this workspace')
  const connection =
    await codeupRepository.findConnectionByWorkspace(workspaceId)
  if (!connection) throw new CodeupApiError(404, 'Codeup is not connected')
  const confirmed = connection.repositories.some(
    r => r.confirmedAt !== null && r.pathWithNamespace === repository
  )
  if (!confirmed)
    throw new CodeupApiError(403, 'Codeup repository is not confirmed')
  return encodeCodeupCredential({
    organizationId: connection.organizationId,
    token: decrypt(connection.accessToken),
  })
}

async function clientForRepo(
  workspaceId: string,
  repository: string
): Promise<CodeupClient> {
  return clientFor(await getRepoToken(workspaceId, repository))
}

const comments: GitCommentClient = {
  async createIssueComment(input) {
    const ref = mrRef(repositoryOf(input.repo), input.prNumber)
    const client = clientFor(input.token)
    const { head } = await versionsOf(client, ref)
    const { commentBizId } = await client.createComment(
      ref,
      head.patchSetBizId,
      { type: 'GLOBAL_COMMENT', content: input.body }
    )
    return { id: encodeCommentId(input.prNumber, commentBizId) }
  },
  async updateIssueComment(input) {
    const { localId, commentBizId } = decodeCommentId(input.externalId)
    await clientFor(input.token).updateComment(
      mrRef(repositoryOf(input.repo), localId),
      commentBizId,
      input.body
    )
  },
  async updateReviewLineComment(input) {
    const { localId, commentBizId } = decodeCommentId(input.externalId)
    await clientFor(input.token).updateComment(
      mrRef(repositoryOf(input.repo), localId),
      commentBizId,
      input.body
    )
  },
  async deleteIssueComment(input) {
    const { localId, commentBizId } = decodeCommentId(input.externalId)
    await clientFor(input.token).deleteComment(
      mrRef(repositoryOf(input.repo), localId),
      commentBizId
    )
  },
  async listIssueComments(input) {
    const listed = await clientFor(input.token).listComments(
      mrRef(repositoryOf(input.repo), input.prNumber),
      'GLOBAL_COMMENT'
    )
    return listed.map(toListedComment)
  },
  async listReviewComments(input) {
    const listed = await clientFor(input.token).listComments(
      mrRef(repositoryOf(input.repo), input.prNumber),
      'INLINE_COMMENT'
    )
    return listed.map(toListedComment)
  },
  /**
   * Each inline comment on the head version, compared against the base
   * version. Codeup has no review object: the review's own body and event
   * are not posted (no verdict on Codeup), and the answer's id is 0 (no
   * review to record threads against). A comment Codeup refuses does not
   * stop the others; once all were tried the first refusal is thrown (422
   * for a 4xx, like a line GitHub will not take) so the scan retries the
   * unposted ones next sync — the posted ones are deduped by their markers.
   * Any other refusal (auth, permission, server) is thrown as it came.
   */
  async createReview(input) {
    if (input.comments.length === 0)
      throw unsupportedOnCodeup('A review without inline comments')
    const ref = mrRef(repositoryOf(input.repo), input.prNumber)
    const client = clientFor(input.token)
    const { head, base } = await versionsOf(client, ref)
    if (head.commitId !== input.commitId)
      throw new CodeupApiError(422, 'The merge request moved past this head')
    let refused: unknown = null
    for (const c of input.comments) {
      try {
        await client.createComment(ref, head.patchSetBizId, {
          type: 'INLINE_COMMENT',
          content: c.body,
          filePath: c.path,
          lineNumber: c.line,
          fromPatchSetBizId: base.patchSetBizId,
          toPatchSetBizId: head.patchSetBizId,
        })
      } catch (error) {
        refused ??= error
      }
    }
    // Only a refusal of the comment itself (400 / 422: a line or path not
    // in the diff) is the "line not taken" 422; auth / permission / missing
    // MR keep their own status so they surface as what they are.
    if (
      refused instanceof CodeupApiError &&
      (refused.status === 400 || refused.status === 422)
    )
      throw new CodeupApiError(422, refused.message)
    if (refused) throw refused
    return { id: 0, html_url: '' }
  },
  async getPullRequestHead(input) {
    const ref = mrRef(repositoryOf(input.repo), input.prNumber)
    const client = clientFor(input.token)
    const [{ head }, mr] = await Promise.all([
      versionsOf(client, ref),
      client.getChangeRequest(ref),
    ])
    return { sha: head.commitId, state: prStateOf(mr.status) }
  },
  async getPullRequestBody(input) {
    const mr = await clientFor(input.token).getChangeRequest(
      mrRef(repositoryOf(input.repo), input.prNumber)
    )
    return { body: mr.description, state: prStateOf(mr.status) }
  },
  async listPullRequestFiles(input) {
    const { compare } = await compareOf(
      clientFor(input.token),
      mrRef(repositoryOf(input.repo), input.prNumber)
    )
    return toChangedFiles(compare.diffs).map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      ...(f.previous_filename
        ? { previous_filename: f.previous_filename }
        : {}),
    }))
  },
  // reviewThreads / reviewVerdict / descriptionWrite are not declared.
  async createReviewLineReply() {
    throw unsupportedOnCodeup('Replying in a review thread')
  },
  async listIssueCommentsSince() {
    throw unsupportedOnCodeup('Listing comments since a time')
  },
  async listReviewCommentsOfReview() {
    throw unsupportedOnCodeup('Listing a review’s comments')
  },
  async submitReview() {
    throw unsupportedOnCodeup('A review verdict')
  },
  async listReviews() {
    throw unsupportedOnCodeup('Listing reviews')
  },
  async dismissReview() {
    throw unsupportedOnCodeup('Dismissing a review')
  },
  async updatePullRequestBody() {
    throw unsupportedOnCodeup('Writing the merge request description')
  },
}

const reviewThreads: GitReviewThreadClient = {
  async listReviewThreads() {
    throw unsupportedOnCodeup('Review threads')
  },
  async resolveThread() {
    throw unsupportedOnCodeup('Resolving a review thread')
  },
  async unresolveThread() {
    throw unsupportedOnCodeup('Reopening a review thread')
  },
}

const SAFE_PATH = /^[\w.-]+(?:\/[\w.-]+)+$/
const SAFE_SHA = /^[0-9a-f]{7,40}$/i

export const codeupGitProvider: GitProvider = {
  id: CODEUP_PROVIDER,
  capabilities: CODEUP_CAPABILITIES,

  // ── tokens ────────────────────────────────────────────────────────────
  getRepoToken(workspaceId, repository) {
    // One personal access token, whatever the purpose: Codeup mints no
    // narrower one.
    return getRepoToken(workspaceId, repository)
  },
  async revokeToken() {
    // Nothing was minted: the connection's token is the user's own.
    return false
  },

  // ── reads ─────────────────────────────────────────────────────────────
  async readRepoFile(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    return client.getFileContent(opts.fullName, opts.path, opts.ref)
  },
  async withRepoReadToken(opts, fn) {
    return fn(await getRepoToken(opts.workspaceId, opts.fullName))
  },
  async readRepoFileWithToken(opts) {
    return clientFor(opts.token).getFileContent(
      opts.fullName,
      opts.path,
      opts.ref
    )
  },
  async listRepoDirWithToken() {
    throw unsupportedOnCodeup('Listing a repository directory')
  },
  async fetchPrDiff(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const { compare } = await compareOf(
      client,
      mrRef(opts.fullName, opts.prNumber)
    )
    return toUnifiedDiff(compare.diffs)
  },
  async fetchPrChangedFiles(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const { compare } = await compareOf(
      client,
      mrRef(opts.fullName, opts.prNumber)
    )
    return compare.diffs.length
  },
  async fetchPrCommitCount(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const { head, compare } = await compareOf(
      client,
      mrRef(opts.fullName, opts.prNumber)
    )
    // Another head's count would be wrong for this one (port contract).
    if (head.commitId !== opts.head) return null
    return compare.commits.length > 0 ? compare.commits.length : null
  },
  async fetchReviewChangedPaths() {
    // GetCompare does not say whether `base` is an ancestor of `head`; the
    // scan then reviews the whole merge request (never a wrong slice).
    throw unsupportedOnCodeup('An incremental review baseline')
  },
  async fetchCompareDiff() {
    throw unsupportedOnCodeup('Comparing two heads')
  },
  async fetchPrFiles(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const { compare } = await compareOf(
      client,
      mrRef(opts.fullName, opts.prNumber)
    )
    return toChangedFiles(compare.diffs).map(f => ({
      filename: f.filename,
      status: f.status,
      ...(f.patch !== undefined ? { patch: f.patch } : {}),
    }))
  },
  async fetchPrHeadSha(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const { head } = await versionsOf(
      client,
      mrRef(opts.fullName, opts.prNumber)
    )
    return head.commitId
  },
  async fetchPrBody(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const mr = await client.getChangeRequest(
      mrRef(opts.fullName, opts.prNumber)
    )
    return mr.description
  },
  async fetchPrBase(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const ref = mrRef(opts.fullName, opts.prNumber)
    const [{ base }, mr] = await Promise.all([
      versionsOf(client, ref),
      client.getChangeRequest(ref),
    ])
    return { ref: mr.targetBranch, sha: base.commitId }
  },
  async fetchPrDetails(opts) {
    const client = await clientForRepo(opts.workspaceId, opts.fullName)
    const ref = mrRef(opts.fullName, opts.prNumber)
    const [{ head, base }, mr] = await Promise.all([
      versionsOf(client, ref),
      client.getChangeRequest(ref),
    ])
    return {
      title: mr.title,
      body: mr.description ?? '',
      authorLogin: mr.authorUsername,
      state: prStateOf(mr.status),
      headSha: head.commitId,
      baseRef: mr.targetBranch,
      baseSha: base.commitId,
      requestedReviewers: [],
    }
  },
  async readPrTemplate() {
    // Codeup has no pull request template file convention.
    return null
  },
  async fetchDefaultBranchHead() {
    throw unsupportedOnCodeup('Reading the default branch head')
  },
  async fetchRepoVisibility() {
    // Not read: 'unknown' is treated as not public (the cautious side).
    return 'unknown'
  },
  async fetchRepoIssues() {
    throw unsupportedOnCodeup('Repository issues')
  },
  async addedLinesFromDiff(diff) {
    return addedLinesWithNumbers(diff).map(f => ({
      path: f.path,
      addedLines: f.lines.map(l => l.text),
    }))
  },

  // ── code download (LUM-1317) ──────────────────────────────────────────
  async streamRepoTarballWithToken() {
    throw unsupportedOnCodeup('A repository archive')
  },
  createArchiveReader() {
    throw unsupportedOnCodeup('A repository archive')
  },
  async getRepoCloneToken() {
    throw unsupportedOnCodeup('A sandbox clone')
  },
  cloneSource() {
    throw unsupportedOnCodeup('A sandbox clone')
  },

  // ── writes ────────────────────────────────────────────────────────────
  comments,
  reviewThreads,
  isApiError(error): error is GitApiError {
    return error instanceof CodeupApiError
  },

  links: {
    commit(repository, sha) {
      if (!SAFE_PATH.test(repository) || !SAFE_SHA.test(sha)) return null
      return `${CODEUP_WEB_BASE}/${repository}/commit/${sha}`
    },
    reviewComment({ repo, prNumber }) {
      // Codeup has no per-comment anchor: the merge request's page.
      return `${CODEUP_WEB_BASE}/${repositoryOf(repo)}/change/${prNumber}`
    },
  },

  // ── repository gating ─────────────────────────────────────────────────
  isConfirmedRepository(confirmed, repository) {
    return confirmed.includes(repository)
  },
  async loadConfirmedRepositories(workspaceId) {
    const confirmed = (await confirmedPaths(workspaceId)) ?? []
    return repository => (confirmed.includes(repository) ? repository : null)
  },
  findConfirmedRepositories(workspaceId) {
    return confirmedPaths(workspaceId)
  },
  // LUM-1330: no rename record for Codeup.
  async resolveRenamedRepository() {
    return null
  },
  async checkRepositoryWriteAccess() {
    return 'unknown'
  },
}
