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
    return call<Array<{ id: number; body: string; user: { id: number } }>>(
      url,
      { method: 'GET', headers: headers(input.token) }
    ) as Promise<Array<{ id: number; body: string; user: { id: number } }>>
  },

  async listReviewCommentsSince(input: ListIssueCommentsInput) {
    const sinceParam = encodeURIComponent(input.since.toISOString())
    const url = `${GH_API}/repos/${input.repo.owner}/${input.repo.name}/pulls/${input.prNumber}/comments?since=${sinceParam}`
    return call<Array<{ id: number; body: string; user: { id: number } }>>(
      url,
      { method: 'GET', headers: headers(input.token) }
    ) as Promise<Array<{ id: number; body: string; user: { id: number } }>>
  },
}
