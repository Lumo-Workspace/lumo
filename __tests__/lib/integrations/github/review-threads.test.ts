/**
 * @jest-environment node
 *
 * LUM-1127 — the GraphQL review-thread wrapper: pages through threads,
 * resolves / unresolves by node id, and never reads a 200 with `errors` as
 * success.
 */
import {
  reviewThreadClient,
  toReviewThreadState,
} from '@/lib/integrations/github/review-threads'
import { GithubApiError } from '@/lib/integrations/github/pr-comment-client'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body }
}

const node = (id: string, dbId: number) => ({
  id,
  isResolved: false,
  isOutdated: false,
  resolvedBy: null,
  comments: { nodes: [{ databaseId: dbId }] },
})

describe('reviewThreadClient', () => {
  it('walks every page of review threads', async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: true, endCursor: 'c1' },
                  nodes: [node('T1', 1)],
                },
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        ok({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [node('T2', 2)],
                },
              },
            },
          },
        })
      )
    const out = await reviewThreadClient.listReviewThreads({
      repo: { owner: 'o', name: 'r' },
      prNumber: 3,
      token: 'tok',
    })
    expect(out.map(t => [t.id, t.firstCommentId])).toEqual([
      ['T1', 1],
      ['T2', 2],
    ])
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.variables).toMatchObject({
      owner: 'o',
      name: 'r',
      number: 3,
      after: 'c1',
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/graphql')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('resolve / unresolve send the mutation with the thread id', async () => {
    fetchMock.mockResolvedValue(ok({ data: { x: {} } }))
    await reviewThreadClient.resolveThread({ threadId: 'T1', token: 'tok' })
    await reviewThreadClient.unresolveThread({ threadId: 'T1', token: 'tok' })
    const [a, b] = fetchMock.mock.calls.map(c => JSON.parse(c[1].body))
    expect(a.query).toContain('resolveReviewThread')
    expect(b.query).toContain('unresolveReviewThread')
    expect(a.variables).toEqual({ id: 'T1' })
  })

  it('a 200 carrying GraphQL errors is a failure', async () => {
    fetchMock.mockResolvedValue(
      ok({ errors: [{ message: 'Resource not accessible by integration' }] })
    )
    await expect(
      reviewThreadClient.resolveThread({ threadId: 'T1', token: 'tok' })
    ).rejects.toBeInstanceOf(GithubApiError)
  })

  it('an HTTP error is a failure with its status', async () => {
    fetchMock.mockResolvedValue(ok({ message: 'Bad credentials' }, 401))
    await expect(
      reviewThreadClient.unresolveThread({ threadId: 'T1', token: 'tok' })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('toReviewThreadState maps resolvedBy and the first comment id', () => {
    expect(
      toReviewThreadState({
        ...node('T', 9),
        isResolved: true,
        resolvedBy: { login: 'alice', __typename: 'User' },
      })
    ).toEqual({
      id: 'T',
      isResolved: true,
      isOutdated: false,
      resolvedBy: { login: 'alice', type: 'User' },
      firstCommentId: 9,
    })
  })
})
