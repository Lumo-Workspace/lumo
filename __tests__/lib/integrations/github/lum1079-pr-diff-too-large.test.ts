/**
 * @jest-environment node
 *
 * LUM-1079 — GitHub's "diff too large" refusal is flagged on the error
 * `fetchPrDiff` throws, and the PR's changed-file count is readable before
 * asking for a diff.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  fetchPrChangedFiles,
  fetchPrDiff,
} from '@/lib/integrations/github/contents'
import { logger } from '@/lib/logger'

const fetchMock = jest.fn()
const realFetch = global.fetch
beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = realFetch
})
beforeEach(() => jest.clearAllMocks())

const opts = { workspaceId: 'w1', fullName: 'o/r', prNumber: 1384 }

async function thrown(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p
  } catch (error) {
    return error as Record<string, unknown>
  }
  throw new Error('expected a throw')
}

describe('fetchPrDiff', () => {
  test('406 is flagged diffTooLarge and logged as a warning, not an error', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        '{"message":"Sorry, the diff exceeded the maximum number of files (300)."}',
        {
          status: 406,
        }
      )
    )
    const error = await thrown(fetchPrDiff(opts))
    expect(error).toMatchObject({ status: 406, diffTooLarge: true })
    expect(logger.warn).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  test('a too-large body under another status is flagged too', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"errors":[{"code":"too_large"}]}', { status: 422 })
    )
    expect(await thrown(fetchPrDiff(opts))).toMatchObject({
      status: 422,
      diffTooLarge: true,
    })
  })

  test('an outage is not flagged', async () => {
    fetchMock.mockResolvedValue(new Response('bad gateway', { status: 502 }))
    expect(await thrown(fetchPrDiff(opts))).toMatchObject({
      status: 502,
      diffTooLarge: false,
    })
    expect(logger.error).toHaveBeenCalled()
  })

  test('a diff is returned as text', async () => {
    fetchMock.mockResolvedValue(new Response('diff --git a b', { status: 200 }))
    await expect(fetchPrDiff(opts)).resolves.toBe('diff --git a b')
  })
})

describe('fetchPrChangedFiles', () => {
  test('reads changed_files off the pulls payload', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ changed_files: 504 }), { status: 200 })
    )
    await expect(fetchPrChangedFiles(opts)).resolves.toBe(504)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.github.com/repos/o/r/pulls/1384'
    )
  })

  test('null when GitHub does not say', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await expect(fetchPrChangedFiles(opts)).resolves.toBeNull()
  })

  test('throws on an API error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }))
    expect(await thrown(fetchPrChangedFiles(opts))).toMatchObject({
      status: 404,
    })
  })
})
