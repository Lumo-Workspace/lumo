/**
 * LUM-1315 — HTTP client for Codeup (Alibaba Cloud Yunxiao, center edition).
 *
 * REST base `https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/
 * {organizationId}/…`, authenticated with a personal access token in the
 * `x-yunxiao-token` header (never in a URL). There is no app identity: every
 * call runs as the token's owner. Endpoints (Alibaba Cloud developer
 * reference): ListRepositories, CreateWebHook, DeleteWebHook; LUM-1316:
 * GetChangeRequest, ListChangeRequestPatchSets, GetCompare, GetFileBlobs,
 * Create / Update / Delete / ListChangeRequestComment(s). A repository is
 * addressed by its URL-encoded full path, which Codeup takes as its id.
 *
 * The token is never logged, never put into an error message.
 */

import { logger } from '@/lib/logger'

export const CODEUP_API_BASE = 'https://openapi-rdc.aliyuncs.com'

/** Codeup's page-size ceiling for list endpoints. */
const PER_PAGE = 100

/** Hard cap on pages read while listing repositories (100 per page). */
const MAX_PAGES = 10

/** A repository as Lumo uses it (ListRepositories response, trimmed). */
export interface CodeupRepositorySummary {
  id: number
  name: string
  /** Full path, nested groups included: `org/group/sub/repo`. */
  pathWithNamespace: string
  webUrl: string
}

/** A non-2xx answer from Codeup. `status` is the HTTP status. */
export class CodeupApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'CodeupApiError'
    this.status = status
  }
}

/** Whether a Codeup error means the token or organization was refused. */
export function isCodeupAuthError(err: unknown): boolean {
  return (
    err instanceof CodeupApiError &&
    (err.status === 401 || err.status === 403 || err.status === 404)
  )
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * LUM-1316 — a merge request as Lumo reads it (GetChangeRequest, trimmed).
 * `ahead` = commits on the source branch not on the target.
 */
export interface CodeupChangeRequest {
  title: string
  description: string | null
  status: string
  sourceBranch: string
  targetBranch: string
  sourceCommitId: string | null
  ahead: number | null
  authorUsername: string | null
  webUrl: string | null
}

/** LUM-1316 — one version of a merge request (ListChangeRequestPatchSets). */
export interface CodeupPatchSet {
  patchSetBizId: string
  commitId: string
  /** `MERGE_SOURCE` (the source branch) or `MERGE_TARGET`. */
  relatedMergeItemType: string
  versionNo: number
}

/** LUM-1316 — one file of a comparison (GetCompare `diffs[]`). */
export interface CodeupCompareDiff {
  oldPath: string
  newPath: string
  diff: string
  newFile: boolean
  deletedFile: boolean
  renamedFile: boolean
  isBinary: boolean
}

/** LUM-1316 — GetCompare, trimmed: commit ids and per-file diffs. */
export interface CodeupCompare {
  commits: string[]
  diffs: CodeupCompareDiff[]
}

/** LUM-1316 — one merge request comment (ListChangeRequestComments). */
export interface CodeupComment {
  commentBizId: string
  commentType: string
  content: string
  filePath: string | null
  lineNumber: number | null
  commentTime: string | null
}

/** LUM-1316 — what CreateChangeRequestComment takes. */
export type CodeupNewComment =
  | { type: 'GLOBAL_COMMENT'; content: string }
  | {
      type: 'INLINE_COMMENT'
      content: string
      /** Repository-relative, no leading slash (the client adds Codeup's). */
      filePath: string
      lineNumber: number
      fromPatchSetBizId: string
      toPatchSetBizId: string
    }

/** LUM-1316 — the merge request and repository a call is about. */
export interface CodeupMergeRequestRef {
  /** The repository's full path (`org/group/repo`); sent URL-encoded. */
  repository: string
  localId: number
}

export interface CodeupClient {
  listRepositories(): Promise<CodeupRepositorySummary[]>
  createWebhook(
    repositoryId: number,
    input: { url: string; token: string }
  ): Promise<{ id: number }>
  deleteWebhook(repositoryId: number, hookId: number): Promise<void>
  getChangeRequest(ref: CodeupMergeRequestRef): Promise<CodeupChangeRequest>
  listPatchSets(ref: CodeupMergeRequestRef): Promise<CodeupPatchSet[]>
  /** `from` / `to` in git CLI order (`git diff from...to`). */
  compare(repository: string, from: string, to: string): Promise<CodeupCompare>
  /** A file's text at `ref` (default branch when absent); null on 404. */
  getFileContent(
    repository: string,
    path: string,
    ref?: string
  ): Promise<string | null>
  createComment(
    ref: CodeupMergeRequestRef,
    patchSetBizId: string,
    comment: CodeupNewComment
  ): Promise<{ commentBizId: string }>
  updateComment(
    ref: CodeupMergeRequestRef,
    commentBizId: string,
    content: string
  ): Promise<void>
  deleteComment(ref: CodeupMergeRequestRef, commentBizId: string): Promise<void>
  /** Published comments of one type, resolved and unresolved alike. */
  listComments(
    ref: CodeupMergeRequestRef,
    type: 'GLOBAL_COMMENT' | 'INLINE_COMMENT'
  ): Promise<CodeupComment[]>
}

/** URL-encoded full path — Codeup takes it wherever a repository id goes. */
export function encodeRepository(repository: string): string {
  return encodeURIComponent(repository)
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

/** Narrow a GetChangeRequest body; throws 502 when it is not one. */
export function toChangeRequest(body: unknown): CodeupChangeRequest {
  const b = asObj(body)
  const sourceBranch = asStr(b?.sourceBranch)
  const targetBranch = asStr(b?.targetBranch)
  if (!b || !sourceBranch || !targetBranch) {
    throw new CodeupApiError(502, 'Codeup returned no merge request')
  }
  return {
    title: asStr(b.title) ?? '',
    description: asStr(b.description),
    status: asStr(b.status) ?? '',
    sourceBranch,
    targetBranch,
    sourceCommitId: asStr(b.sourceCommitId),
    ahead: asInt(b.ahead),
    authorUsername: asStr(asObj(b.author)?.username),
    webUrl: asStr(b.webUrl) ?? asStr(b.detailUrl),
  }
}

/** Narrow ListChangeRequestPatchSets rows; malformed rows are dropped. */
export function toPatchSets(body: unknown): CodeupPatchSet[] {
  if (!Array.isArray(body)) return []
  const out: CodeupPatchSet[] = []
  for (const row of body) {
    const r = asObj(row)
    const patchSetBizId = asStr(r?.patchSetBizId)
    const commitId = asStr(r?.commitId)
    const relatedMergeItemType = asStr(r?.relatedMergeItemType)
    if (!r || !patchSetBizId || !commitId || !relatedMergeItemType) continue
    out.push({
      patchSetBizId,
      commitId,
      relatedMergeItemType,
      versionNo: asInt(r.versionNo) ?? 0,
    })
  }
  return out
}

/** Narrow a GetCompare body. */
export function toCompare(body: unknown): CodeupCompare {
  const b = asObj(body)
  const commits = Array.isArray(b?.commits)
    ? b.commits.flatMap(c => {
        const id = asStr(asObj(c)?.id)
        return id ? [id] : []
      })
    : []
  const diffs: CodeupCompareDiff[] = []
  for (const row of Array.isArray(b?.diffs) ? b.diffs : []) {
    const r = asObj(row)
    const newPath = asStr(r?.newPath)
    const oldPath = asStr(r?.oldPath) ?? newPath
    if (!r || !newPath || !oldPath) continue
    diffs.push({
      oldPath,
      newPath,
      diff: asStr(r.diff) ?? '',
      newFile: r.newFile === true,
      deletedFile: r.deletedFile === true,
      renamedFile: r.renamedFile === true,
      isBinary: r.isBinary === true || r.binary === true,
    })
  }
  return { commits, diffs }
}

/** Narrow ListChangeRequestComments rows (deleted ones dropped). */
export function toComments(body: unknown): CodeupComment[] {
  if (!Array.isArray(body)) return []
  const out: CodeupComment[] = []
  for (const row of body) {
    const r = asObj(row)
    const commentBizId = asStr(r?.comment_biz_id)
    if (!r || !commentBizId || r.is_deleted === true) continue
    out.push({
      commentBizId,
      commentType: asStr(r.comment_type) ?? '',
      content: asStr(r.content) ?? '',
      filePath: asStr(r.filePath) ?? asStr(r.file_path),
      lineNumber: asInt(r.line_number),
      commentTime: asStr(r.comment_time),
    })
  }
  return out
}

/** A GetFileBlobs body's text (base64 decoded); null when it has none. */
export function toFileText(body: unknown): string | null {
  const b = asObj(body)
  const content = asStr(b?.content)
  if (content === null) return null
  return asStr(b?.encoding) === 'base64'
    ? Buffer.from(content, 'base64').toString('utf8')
    : content
}

/** Organization ids are opaque tokens (a 24-hex id in practice). */
export function isValidOrganizationId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}

/** Narrow one ListRepositories row; null when a required field is missing. */
export function toRepositorySummary(
  row: unknown
): CodeupRepositorySummary | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (
    typeof r.id !== 'number' ||
    typeof r.pathWithNamespace !== 'string' ||
    typeof r.webUrl !== 'string'
  ) {
    return null
  }
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : r.pathWithNamespace,
    pathWithNamespace: r.pathWithNamespace,
    webUrl: r.webUrl,
  }
}

export function createCodeupClient(
  organizationId: string,
  token: string,
  fetchImpl: FetchLike = fetch
): CodeupClient {
  if (!isValidOrganizationId(organizationId)) {
    throw new CodeupApiError(400, 'Invalid Codeup organization id')
  }
  const orgBase = `${CODEUP_API_BASE}/oapi/v1/codeup/organizations/${encodeURIComponent(organizationId)}`

  async function call(
    path: string,
    init: { method: string; body?: unknown }
  ): Promise<Response> {
    const res = await fetchImpl(`${orgBase}${path}`, {
      method: init.method,
      headers: {
        'x-yunxiao-token': token,
        Accept: 'application/json',
        ...(init.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    if (!res.ok) {
      throw new CodeupApiError(
        res.status,
        `Codeup ${init.method} ${path.split('?')[0]} failed with ${res.status}`
      )
    }
    return res
  }

  return {
    async listRepositories() {
      const out: CodeupRepositorySummary[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await call(
          `/repositories?page=${page}&perPage=${PER_PAGE}&archived=false`,
          { method: 'GET' }
        )
        const rows = (await res.json()) as unknown
        if (!Array.isArray(rows)) break
        for (const row of rows) {
          const summary = toRepositorySummary(row)
          if (summary) out.push(summary)
        }
        const next = res.headers.get('x-next-page')
        if (rows.length < PER_PAGE || !next) break
        if (page === MAX_PAGES) {
          logger.warn(
            `[codeup] organization lists more than ${MAX_PAGES * PER_PAGE} repositories; only the first ${MAX_PAGES * PER_PAGE} are offered`
          )
        }
      }
      return out
    },

    async createWebhook(repositoryId, input) {
      const res = await call(`/repositories/${repositoryId}/webhooks`, {
        method: 'POST',
        body: {
          url: input.url,
          token: input.token,
          pushEvents: true,
          mergeRequestsEvents: true,
          noteEvents: false,
          tagPushEvents: false,
          enableSslVerification: true,
          description: 'Lumo',
        },
      })
      const json = (await res.json()) as { id?: unknown }
      if (typeof json.id !== 'number') {
        throw new CodeupApiError(502, 'Codeup returned no webhook id')
      }
      return { id: json.id }
    },

    async deleteWebhook(repositoryId, hookId) {
      await call(`/repositories/${repositoryId}/webhooks/${hookId}`, {
        method: 'DELETE',
      })
    },

    // ── LUM-1316: merge requests (GetChangeRequest, ListChangeRequestPatchSets,
    // GetCompare, GetFileBlobs, Create/Update/Delete/ListChangeRequestComment) ─

    async getChangeRequest(ref) {
      const res = await call(mrPath(ref), { method: 'GET' })
      return toChangeRequest(await res.json())
    },

    async listPatchSets(ref) {
      const res = await call(`${mrPath(ref)}/diffs/patches`, {
        method: 'GET',
      })
      return toPatchSets(await res.json())
    },

    async compare(repository, from, to) {
      const query = new URLSearchParams({ from, to })
      const res = await call(
        `/repositories/${encodeRepository(repository)}/compares?${query}`,
        { method: 'GET' }
      )
      return toCompare(await res.json())
    },

    async getFileContent(repository, path, ref) {
      const file = encodeURIComponent(path.replace(/^\/+/, ''))
      const query = ref ? `?${new URLSearchParams({ ref })}` : ''
      try {
        const res = await call(
          `/repositories/${encodeRepository(repository)}/files/${file}${query}`,
          { method: 'GET' }
        )
        return toFileText(await res.json())
      } catch (error) {
        if (error instanceof CodeupApiError && error.status === 404) return null
        throw error
      }
    },

    async createComment(ref, patchSetBizId, comment) {
      const body: Record<string, unknown> = {
        comment_type: comment.type,
        content: comment.content,
        draft: false,
        resolved: false,
        patchset_biz_id: patchSetBizId,
      }
      if (comment.type === 'INLINE_COMMENT') {
        // Codeup's paths carry a leading slash (CreateChangeRequestComment).
        body.file_path = `/${comment.filePath.replace(/^\/+/, '')}`
        body.line_number = comment.lineNumber
        body.from_patchset_biz_id = comment.fromPatchSetBizId
        body.to_patchset_biz_id = comment.toPatchSetBizId
      }
      const res = await call(`${mrPath(ref)}/comments`, {
        method: 'POST',
        body,
      })
      const json = asObj(await res.json())
      const commentBizId = asStr(json?.comment_biz_id)
      if (!commentBizId) {
        throw new CodeupApiError(502, 'Codeup returned no comment id')
      }
      return { commentBizId }
    },

    async updateComment(ref, commentBizId, content) {
      await call(
        `${mrPath(ref)}/comments/${encodeURIComponent(commentBizId)}`,
        { method: 'PUT', body: { content } }
      )
    },

    async deleteComment(ref, commentBizId) {
      await call(
        `${mrPath(ref)}/comments/${encodeURIComponent(commentBizId)}`,
        { method: 'DELETE' }
      )
    },

    async listComments(ref, type) {
      // The listing filters on `resolved`: read both, so a comment someone
      // resolved still counts as posted.
      // Paged like the other list endpoints (`page` / `perPage`); a page
      // that brings no new comment ends the walk too, so a server that
      // ignores the paging cannot loop or double-count.
      const out: CodeupComment[] = []
      const seen = new Set<string>()
      for (const resolved of [false, true]) {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const res = await call(
            `${mrPath(ref)}/comments/list?page=${page}&perPage=${PER_PAGE}`,
            {
              method: 'POST',
              body: {
                patchSetBizIds: [],
                commentType: type,
                state: 'OPENED',
                resolved,
              },
            }
          )
          const body = (await res.json()) as unknown
          const rows = toComments(body)
          const fresh = rows.filter(c => !seen.has(c.commentBizId))
          for (const c of fresh) seen.add(c.commentBizId)
          out.push(...fresh)
          const pageSize = Array.isArray(body) ? body.length : 0
          if (pageSize < PER_PAGE || fresh.length === 0) break
          if (page === MAX_PAGES)
            logger.warn(
              `[codeup] merge request lists more than ${MAX_PAGES * PER_PAGE} comments; markers past them are not seen`
            )
        }
      }
      return out
    },
  }
}

function mrPath(ref: CodeupMergeRequestRef): string {
  if (!Number.isSafeInteger(ref.localId) || ref.localId < 1) {
    throw new CodeupApiError(400, 'Invalid Codeup merge request id')
  }
  return `/repositories/${encodeRepository(ref.repository)}/changeRequests/${ref.localId}`
}
