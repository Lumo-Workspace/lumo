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

/**
 * The one transport. Returns the response headers alongside the body because
 * GitHub puts the page count in `Link` and nowhere else; `call` is the same
 * thing for the (many) callers that only want the body.
 */
async function callWithHeaders<T>(
  url: string,
  init: RequestInit
): Promise<{ body: T | undefined; headers: Headers }> {
  const res = await fetch(url, init)
  if (res.status === 204) return { body: undefined, headers: res.headers }
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
  return { body: body as T, headers: res.headers }
}

async function call<T>(url: string, init: RequestInit): Promise<T | undefined> {
  return (await callWithHeaders<T>(url, init)).body
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
 * Hard stop for either walk (10 pages = 1000 comments). A PR busier than that
 * is pathological; the marker dedupe degrades to "may re-post", never to a
 * hang. Both walks are newest-first, so a PR over the cap only loses its
 * OLDEST comments to the window — the newest ones, where Lumo's own markers
 * live, always stay in view.
 */
const MAX_COMMENT_PAGES = 10

/** `<…page=7…>; rel="last"` → 7. Anything else (a single page) → 1. */
function lastPageOf(link: string | null): number {
  if (!link) return 1
  const rel = /<([^>]+)>;\s*rel="last"/.exec(link)
  const page = rel?.[1] ? /[?&]page=(\d+)/.exec(rel[1]) : null
  const n = page?.[1] ? Number(page[1]) : 1
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}

/**
 * `/pulls/{n}/comments` HONOURS `sort`/`direction`, so newest-first is just a
 * query parameter and a page shorter than the cap ends the walk.
 */
async function listSortedComments(
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

/**
 * `/issues/{n}/comments` IGNORES `sort`/`direction` — it always answers
 * oldest-first — so passing them bought a false sense of newest-first and put
 * Lumo's summary (one of the newest comments) outside the window on any PR
 * with more than `MAX_COMMENT_PAGES` pages of comments. Instead: read page 1,
 * take the last page number out of its `Link` header, and walk backwards from
 * there, so the pages that are read are always the newest ones.
 */
async function listOldestFirstComments(
  baseUrl: string,
  token: string
): Promise<ListedComment[]> {
  const init = { method: 'GET', headers: headers(token) }
  const first = await callWithHeaders<ListedComment[]>(
    `${baseUrl}?per_page=${COMMENTS_PER_PAGE}&page=1`,
    init
  )
  const firstRows = first.body ?? []
  const last = lastPageOf(first.headers.get('Link'))
  if (last <= 1) return firstRows

  const out: ListedComment[] = []
  const stopAt = Math.max(1, last - MAX_COMMENT_PAGES + 1)
  for (let page = last; page >= stopAt; page -= 1) {
    // Page 1 is already in hand — never fetch it twice.
    if (page === 1) {
      out.push(...firstRows)
      continue
    }
    const rows =
      (await call<ListedComment[]>(
        `${baseUrl}?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
        init
      )) ?? []
    out.push(...rows)
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
   * LUM-735 — the newest issue comments on the PR (used to find the security
   * summary by its marker), newest page first via the `Link` header.
   */
  async listIssueComments(input: ListAllCommentsInput) {
    const base = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/issues/${input.prNumber}/comments`
    return listOldestFirstComments(base, input.token)
  },

  /** LUM-735 — every inline review comment on the PR (fingerprint dedupe). */
  async listReviewComments(input: ListAllCommentsInput) {
    const base = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments`
    return listSortedComments(base, input.token)
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
   * comments apart from a human quoting one of its markers. GitHub returns
   * `null` here for comments whose account has since been deleted, so every
   * read of it must be optional. */
  user: { id: number; type?: string } | null
}
