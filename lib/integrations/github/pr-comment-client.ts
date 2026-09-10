const GH_API = 'https://api.github.com'

interface Repo {
  owner: string
  name: string
}

export class GithubApiError extends Error {
  status: number
  body: unknown
  rateLimitResetAt?: Date

  constructor(status: number, body: unknown, rateLimitResetAt?: Date) {
    super(
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `GitHub API error ${status}`
    )
    this.status = status
    this.body = body
    if (rateLimitResetAt !== undefined) {
      this.rateLimitResetAt = rateLimitResetAt
    }
  }
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T | undefined> {
  const res = await fetch(url, init)
  if (res.status === 204) return undefined
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    let resetAt: Date | undefined
    if (
      res.status === 403 &&
      res.headers.get('X-RateLimit-Remaining') === '0'
    ) {
      const resetHeader = res.headers.get('X-RateLimit-Reset')
      if (resetHeader) resetAt = new Date(Number(resetHeader) * 1000)
    }
    throw new GithubApiError(res.status, body, resetAt)
  }
  return body as T
}

interface CommentResponse {
  id: number
  node_id: string
  html_url: string
  updated_at: string
  body: string
}

interface CreateIssueCommentInput {
  repo: Repo
  prNumber: number
  body: string
  token: string
}

interface CreateReviewLineReplyInput {
  repo: Repo
  prNumber: number
  inReplyTo: number
  body: string
  token: string
}

interface UpdateCommentInput {
  repo: Repo
  externalId: string
  body: string
  token: string
}

interface DeleteCommentInput {
  repo: Repo
  externalId: string
  token: string
}

interface ListIssueCommentsInput {
  repo: Repo
  prNumber: number
  since: Date
  token: string
}

/** LUM-735 — a whole-PR listing (no `since`), walked page by page. */
interface ListAllCommentsInput {
  repo: Repo
  prNumber: number
  token: string
}

interface CreateReviewInput {
  repo: Repo
  prNumber: number
  token: string
  commitId: string
  body: string
  comments: Array<{
    path: string
    line: number
    side: 'RIGHT'
    body: string
  }>
}

interface ReviewResponse {
  id: number
  html_url: string
}

/**
 * GitHub's page size cap. A page shorter than this is the last one, so the
 * walk needs no Link-header parsing.
 */
const COMMENTS_PER_PAGE = 100

/**
 * Hard stop for the walk (10 pages = 1000 comments). A PR busier than that is
 * pathological; the marker dedupe degrades to "may re-post", never to a hang.
 * Walking newest-first (`sort=created&direction=desc`, supported by both
 * `/pulls/{n}/comments` and `/issues/{n}/comments`) means a PR over the cap
 * only loses its OLDEST comments to the window — the newest ones, where
 * Lumo's own markers live, always stay in view.
 */
const MAX_COMMENT_PAGES = 10

async function listAllComments(
  baseUrl: string,
  token: string
): Promise<ListedComment[]> {
  const out: ListedComment[] = []
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const rows =
      (await call<ListedComment[]>(
        `${baseUrl}?per_page=${COMMENTS_PER_PAGE}&page=${page}&sort=created&direction=desc`,
        { method: 'GET', headers: headers(token) }
      )) ?? []
    out.push(...rows)
    if (rows.length < COMMENTS_PER_PAGE) break
  }
  return out
}

export const prCommentClient = {
  async createIssueComment(input: CreateIssueCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/${input.prNumber}/comments`
    return call<CommentResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body }),
    }) as Promise<CommentResponse>
  },

  async createReviewLineReply(input: CreateReviewLineReplyInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments`
    return call<CommentResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body, in_reply_to: input.inReplyTo }),
    }) as Promise<CommentResponse>
  },

  async updateIssueComment(input: UpdateCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/comments/${input.externalId}`
    return call<CommentResponse>(url, {
      method: 'PATCH',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body }),
    }) as Promise<CommentResponse>
  },

  async updateReviewLineComment(input: UpdateCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/comments/${input.externalId}`
    return call<CommentResponse>(url, {
      method: 'PATCH',
      headers: headers(input.token),
      body: JSON.stringify({ body: input.body }),
    }) as Promise<CommentResponse>
  },

  async deleteIssueComment(input: DeleteCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/comments/${input.externalId}`
    await call<void>(url, { method: 'DELETE', headers: headers(input.token) })
  },

  async deleteReviewLineComment(input: DeleteCommentInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/comments/${input.externalId}`
    await call<void>(url, { method: 'DELETE', headers: headers(input.token) })
  },

  async listIssueCommentsSince(input: ListIssueCommentsInput) {
    const sinceParam = encodeURIComponent(input.since.toISOString())
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/${input.prNumber}/comments?since=${sinceParam}`
    return call<Array<ListedComment>>(url, {
      method: 'GET',
      headers: headers(input.token),
    }) as Promise<Array<ListedComment>>
  },

  /**
   * LUM-735 — every issue comment on the PR (used to find the security
   * summary by its marker). Paginated: the marker may sit on an old comment.
   */
  async listIssueComments(input: ListAllCommentsInput) {
    const base = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/${input.prNumber}/comments`
    return listAllComments(base, input.token)
  },

  /** LUM-735 — every inline review comment on the PR (fingerprint dedupe). */
  async listReviewComments(input: ListAllCommentsInput) {
    const base = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments`
    return listAllComments(base, input.token)
  },

  /**
   * LUM-735 — one review carrying every inline comment. `event: 'COMMENT'`
   * only annotates: it never approves and never requests changes, so the PR's
   * own review requirements are untouched.
   */
  async createReview(input: CreateReviewInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/reviews`
    return call<ReviewResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({
        commit_id: input.commitId,
        body: input.body,
        event: 'COMMENT',
        comments: input.comments,
      }),
    }) as Promise<ReviewResponse>
  },

  async listReviewCommentsSince(input: ListIssueCommentsInput) {
    const sinceParam = encodeURIComponent(input.since.toISOString())
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments?since=${sinceParam}`
    return call<Array<ListedComment>>(url, {
      method: 'GET',
      headers: headers(input.token),
    }) as Promise<Array<ListedComment>>
  },
}

/**
 * Shape of a single comment returned by GitHub's list-comments endpoints.
 * Both /issues/{n}/comments and /pulls/{n}/comments populate these fields.
 */
export interface ListedComment {
  id: number
  node_id: string
  html_url: string
  body: string
  updated_at: string
  /** `type` is `'Bot'` for a GitHub App's bot user — used to tell Lumo's own
   * comments apart from a human quoting one of its markers. `login` is kept
   * for debugging; neither is required by every caller. */
  user: { id: number; type?: string; login?: string }
}
