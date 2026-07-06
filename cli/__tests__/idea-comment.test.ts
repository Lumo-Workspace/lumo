/** @jest-environment node */
jest.mock('../src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { ideaComment, ideaCommentList } from '../src/commands/idea-comment'
import { readCredentials } from '../src/lib/config'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: jest.Mock
let stdout: string[]
let logs: string[]
let stderr: string[]

beforeEach(() => {
  jest.clearAllMocks()
  stdout = []
  logs = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.join(' '))
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    stderr.push(a.join(' '))
  })
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('idea comments list renders the thread', () => {
  it('GETs the idea comments endpoint and prints each comment body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        comments: [
          {
            id: 'c1',
            authorActorId: 'a1',
            body: 'first comment',
            createdAt: '2026-07-05T00:00:00.000Z',
            replies: [],
          },
          {
            id: 'c2',
            authorActorId: 'a2',
            body: 'second comment',
            createdAt: '2026-07-05T01:00:00.000Z',
            replies: [],
          },
        ],
      })
    )

    const code = await ideaCommentList('LUM-I42')

    expect(code).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/ideas/LUM-I42/comments')
    expect(init.headers.Authorization).toBe('Bearer lum_x')
    const out = logs.join('\n')
    expect(out).toContain('first comment')
    expect(out).toContain('second comment')
  })

  it('prints (no comments) for an empty thread', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { comments: [] }))
    await ideaCommentList('LUM-I42')
    expect(logs.join('\n')).toContain('(no comments)')
  })

  it('errors without hitting the network when not logged in', async () => {
    ;(readCredentials as jest.Mock).mockReturnValueOnce(null)
    const code = await ideaCommentList('LUM-I42')
    expect(code).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('lumo idea comment posts a comment', () => {
  it('POSTs the body to the idea comments endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { comment: { id: 'c1' } })
    )

    const code = await ideaComment('LUM-I42', 'looks good')

    expect(code).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/ideas/LUM-I42/comments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ body: 'looks good' })
    expect(stdout.join('')).toContain('LUM-I42')
  })

  it('rejects an empty body without hitting the network', async () => {
    const code = await ideaComment('LUM-I42', '   ')
    expect(code).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
