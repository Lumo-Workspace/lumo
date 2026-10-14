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
    throw new GithubApiError(
      res.status,
      body,
      rateLimitResetOf(res.status, res.headers)
    )
  }
  return { body: body as T, headers: res.headers }
}

/**
 * When a failed response is a rate limit, the moment it lifts; else undefined.
 * Primary limit: 403/429 with `X-RateLimit-Remaining: 0` → `X-RateLimit-Reset`.
 * LUM-1003 — secondary (abuse) limit: 403/429 with `Retry-After` seconds; a
 * bare 429 waits a minute, GitHub's documented floor.
 */
export function rateLimitResetOf(
  status: number,
  headers: Headers,
  now: Date = new Date()
): Date | undefined {
  if (status !== 403 && status !== 429) return undefined
  if (headers.get('X-RateLimit-Remaining') === '0') {
    const reset = Number(headers.get('X-RateLimit-Reset'))
    if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000)
  }
  const retryAfter = Number(headers.get('Retry-After'))
  if (headers.get('Retry-After') !== null && Number.isFinite(retryAfter)) {
    return new Date(now.getTime() + Math.max(0, retryAfter) * 1000)
  }
  if (status === 429) return new Date(now.getTime() + 60_000)
  return undefined
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
  /** LUM-1130 — 'REQUEST_CHANGES' under the request-changes workflow; default 'COMMENT'. */
  event?: Exclude<ReviewEvent, 'APPROVE'>
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

/** LUM-1130 — what a review can say about the PR (never 'APPROVE' with inline comments). */
export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'

/** LUM-1130 — one review as `GET pulls/{n}/reviews` lists it. */
export interface ListedReview {
  id: number
  /** APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING */
  state: string
  commit_id: string | null
  user: { id?: number; login?: string; type?: string } | null
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

/**
 * `<…page=7…>; rel="last"` → 7. No Link at all (a single page) → 1. A Link
 * that has `rel="next"` but no `rel="last"` (GitHub omits `last` on some
 * search-backed listings) is reported as `null`: the caller must then walk
 * forward instead of assuming page 1 is the newest.
 */
export function lastPageOf(link: string | null): number | null {
  if (!link) return 1
  const rel = /<([^>]+)>;\s*rel="last"/.exec(link)
  if (!rel?.[1]) return /rel="next"/.test(link) ? null : 1
  const page = /[?&]page=(\d+)/.exec(rel[1])
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
async function listOldestFirstComments<T = ListedComment>(
  baseUrl: string,
  token: string
): Promise<T[]> {
  const init = { method: 'GET', headers: headers(token) }
  const first = await callWithHeaders<T[]>(
    `${baseUrl}?per_page=${COMMENTS_PER_PAGE}&page=1`,
    init
  )
  const firstRows = first.body ?? []
  const last = lastPageOf(first.headers.get('Link'))
  if (last === null) {
    // `next` without `last`: the total is unknown, so walk forward until a
    // short page (oldest-first is the best this endpoint offers here).
    const out: T[] = [...firstRows]
    for (let page = 2; page <= MAX_COMMENT_PAGES; page += 1) {
      const rows =
        (await call<T[]>(
          `${baseUrl}?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
          init
        )) ?? []
      out.push(...rows)
      if (rows.length < COMMENTS_PER_PAGE) break
    }
    return out
  }
  if (last <= 1) return firstRows

  const out: T[] = []
  const stopAt = Math.max(1, last - MAX_COMMENT_PAGES + 1)
  for (let page = last; page >= stopAt; page -= 1) {
    // Page 1 is already in hand — never fetch it twice.
    if (page === 1) {
      out.push(...firstRows)
      continue
    }
    const rows =
      (await call<T[]>(
        `${baseUrl}?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
        init
      )) ?? []
    out.push(...rows)
  }
  return out
}

/** LUM-1003 — which GitHub listing a mirror source's comments live in. */
export type AssociationListingKind = 'ISSUE' | 'REVIEW_LINE' | 'REVIEW'

interface ListAssociationsPageInput {
  repo: Repo
  prNumber: number
  kind: AssociationListingKind
  page: number
  token: string
}

export interface AssociationsPage {
  items: Array<{ id: number; authorAssociation: string | null }>
  hasNext: boolean
  /** `X-RateLimit-Remaining` after this call; null when absent. */
  rateLimitRemaining: number | null
}

const ASSOCIATION_LISTING_PATH: Record<AssociationListingKind, string> = {
  ISSUE: 'issues/{n}/comments',
  REVIEW_LINE: 'pulls/{n}/comments',
  REVIEW: 'pulls/{n}/reviews',
}

export const prCommentClient = {
  /**
   * LUM-1003 — one page of a PR's comments (or reviews), reduced to
   * `id` + `author_association`, for the mirror author-association backfill.
   * Oldest-first, 100 per page; `hasNext` comes from the `Link` header.
   */
  async listAuthorAssociationsPage(
    input: ListAssociationsPageInput
  ): Promise<AssociationsPage> {
    const path = ASSOCIATION_LISTING_PATH[input.kind].replace(
      '{n}',
      String(input.prNumber)
    )
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/${path}?per_page=${COMMENTS_PER_PAGE}&page=${input.page}`
    const { body, headers: h } = await callWithHeaders<
      Array<{ id: number; author_association?: string | null }>
    >(url, { method: 'GET', headers: headers(input.token) })
    const remaining = h.get('X-RateLimit-Remaining')
    return {
      items: (body ?? []).map(c => ({
        id: c.id,
        authorAssociation:
          typeof c.author_association === 'string'
            ? c.author_association
            : null,
      })),
      hasNext: /rel="next"/.test(h.get('Link') ?? ''),
      rateLimitRemaining:
        remaining !== null && Number.isFinite(Number(remaining))
          ? Number(remaining)
          : null,
    }
  },

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
   * (the default) only annotates: it never approves and never requests
   * changes, so the PR's own review requirements are untouched. LUM-1130:
   * the workspace's request-changes workflow posts it as 'REQUEST_CHANGES'.
   */
  async createReview(input: CreateReviewInput) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/reviews`
    return call<ReviewResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({
        commit_id: input.commitId,
        body: input.body,
        event: input.event ?? 'COMMENT',
        comments: input.comments,
      }),
    }) as Promise<ReviewResponse>
  },

  /**
   * LUM-1127 — the inline comments one review carried (one page of up to
   * 100 — a Lumo review never carries more than `REVIEW_MAX_INLINE`), so the
   * write-back can record each new comment's id against its fingerprint.
   */
  async listReviewCommentsOfReview(input: {
    repo: Repo
    prNumber: number
    reviewId: number
    token: string
  }) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/reviews/${input.reviewId}/comments?per_page=${COMMENTS_PER_PAGE}`
    return ((await call<ListedComment[]>(url, {
      method: 'GET',
      headers: headers(input.token),
    })) ?? []) as ListedComment[]
  },

  async listReviewCommentsSince(input: ListIssueCommentsInput) {
    const sinceParam = encodeURIComponent(input.since.toISOString())
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments?since=${sinceParam}`
    return call<Array<ListedComment>>(url, {
      method: 'GET',
      headers: headers(input.token),
    }) as Promise<Array<ListedComment>>
  },

  /**
   * LUM-1130 — a review with no inline comments: Lumo's verdict
   * ('APPROVE' / 'REQUEST_CHANGES') on `commitId`.
   */
  async submitReview(input: {
    repo: Repo
    prNumber: number
    token: string
    commitId: string
    body: string
    event: Exclude<ReviewEvent, 'COMMENT'>
  }) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/reviews`
    return call<ReviewResponse>(url, {
      method: 'POST',
      headers: headers(input.token),
      body: JSON.stringify({
        commit_id: input.commitId,
        body: input.body,
        event: input.event,
      }),
    }) as Promise<ReviewResponse>
  },

  /** LUM-1130 — every review on the PR, oldest first (newest pages kept). */
  async listReviews(input: ListAllCommentsInput): Promise<ListedReview[]> {
    const base = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/reviews`
    return listOldestFirstComments<ListedReview>(base, input.token)
  },

  /**
   * LUM-1130 — dismiss one review (Lumo's own earlier "changes requested",
   * once it approves), so GitHub stops showing it.
   */
  async dismissReview(input: {
    repo: Repo
    prNumber: number
    reviewId: number
    message: string
    token: string
  }) {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/reviews/${input.reviewId}/dismissals`
    await call<unknown>(url, {
      method: 'PUT',
      headers: headers(input.token),
      body: JSON.stringify({ message: input.message, event: 'DISMISS' }),
    })
  },

  /**
   * LUM-1130 — the PR's live head and state, read right before an approval
   * is submitted (a push since the review means no approval).
   */
  async getPullRequestHead(input: {
    repo: Repo
    prNumber: number
    token: string
  }): Promise<{ sha: string; state: string } | null> {
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}`
    const pr = await call<{ state?: string; head?: { sha?: string } }>(url, {
      method: 'GET',
      headers: headers(input.token),
    })
    const sha = pr?.head?.sha
    return sha && pr?.state ? { sha, state: pr.state } : null
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
  user: { id: number; type?: string; login?: string } | null
  /** LUM-1127 — review-line comments only: set on a reply, absent on a thread's first comment. */
  in_reply_to_id?: number | null
}
