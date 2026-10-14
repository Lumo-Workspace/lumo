/**
 * LUM-1127 — a pull request's review threads, read and resolved over GitHub's
 * GraphQL API (REST has no thread object: a thread's node id, whether it is
 * resolved or outdated, and the resolve / unresolve mutations exist only in
 * GraphQL). Callers go through this wrapper, never `fetch` GraphQL themselves.
 *
 * Token: resolving and unresolving threads needs `pull_requests: write` AND
 * `contents: write` — GitHub refuses the mutations to a `pull_requests`-only
 * installation token with "Resource not accessible by integration" (mint with
 * `REPO_TOKEN_PERMISSIONS.reviewThreadWrite`). Reading them needs
 * `pull_requests: read`.
 */
import { GithubApiError } from './pr-comment-client'

const GH_GRAPHQL = 'https://api.github.com/graphql'

/** 100 threads a page, at most 10 pages — the same 1000 bound as the REST walks. */
const THREADS_PER_PAGE = 100
const MAX_THREAD_PAGES = 10

export interface ReviewThreadState {
  /** GraphQL node id of the thread — what the mutations take. */
  id: string
  isResolved: boolean
  /** The thread's line no longer exists on the PR head. */
  isOutdated: boolean
  /** Who resolved it; null while unresolved (or a deleted account). */
  resolvedBy: { login: string; type: string } | null
  /** REST id (`databaseId`) of the thread's first comment; null if unknown. */
  firstCommentId: number | null
}

interface GraphqlResponse<T> {
  data?: T
  errors?: Array<{ message?: string; type?: string }>
}

async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetch(GH_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json().catch(() => null)) as GraphqlResponse<T> | null
  if (!res.ok) throw new GithubApiError(res.status, body)
  // GraphQL reports a refused mutation (no permission, unknown node) as 200
  // with an `errors` array — never read that as success.
  if (!body || (body.errors && body.errors.length > 0) || !body.data) {
    const message =
      body?.errors?.map(e => e.message ?? e.type ?? 'error').join('; ') ??
      'empty GraphQL response'
    throw new GithubApiError(res.status === 200 ? 422 : res.status, {
      message,
    })
  }
  return body.data
}

const THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${THREADS_PER_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          resolvedBy { login __typename }
          comments(first: 1) { nodes { databaseId } }
        }
      }
    }
  }
}`

/** One thread node as the query above returns it. */
export interface ReviewThreadNode {
  id: string
  isResolved: boolean
  isOutdated: boolean
  resolvedBy: { login: string; __typename: string } | null
  comments: { nodes: Array<{ databaseId: number | null }> }
}

interface ThreadsPage {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: ReviewThreadNode[]
      }
    } | null
  } | null
}

/** Pure; exported for tests. One GraphQL thread node → the wrapper's shape. */
export function toReviewThreadState(node: ReviewThreadNode): ReviewThreadState {
  return {
    id: node.id,
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    resolvedBy: node.resolvedBy
      ? { login: node.resolvedBy.login, type: node.resolvedBy.__typename }
      : null,
    firstCommentId: node.comments.nodes[0]?.databaseId ?? null,
  }
}

export const reviewThreadClient = {
  /** Every review thread on the PR (bounded at 1000), oldest first. */
  async listReviewThreads(input: {
    repo: { owner: string; name: string }
    prNumber: number
    token: string
  }): Promise<ReviewThreadState[]> {
    const out: ReviewThreadState[] = []
    let after: string | null = null
    for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
      const data: ThreadsPage = await graphql<ThreadsPage>(
        input.token,
        THREADS_QUERY,
        {
          owner: input.repo.owner,
          name: input.repo.name,
          number: input.prNumber,
          after,
        }
      )
      const threads = data.repository?.pullRequest?.reviewThreads
      if (!threads) break
      out.push(...threads.nodes.map(toReviewThreadState))
      if (!threads.pageInfo.hasNextPage || !threads.pageInfo.endCursor) break
      after = threads.pageInfo.endCursor
    }
    return out
  },

  async resolveThread(input: { threadId: string; token: string }) {
    await graphql(
      input.token,
      `
        mutation ($id: ID!) {
          resolveReviewThread(input: { threadId: $id }) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      { id: input.threadId }
    )
  },

  async unresolveThread(input: { threadId: string; token: string }) {
    await graphql(
      input.token,
      `
        mutation ($id: ID!) {
          unresolveReviewThread(input: { threadId: $id }) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      { id: input.threadId }
    )
  },
}
