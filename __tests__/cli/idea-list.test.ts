/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'lum_x',
    apiUrl: 'https://api.test',
    workspaceSlug: 'lumo',
  })),
}))

import { ideaList, formatIdeaList } from '@/cli/src/commands/idea'
import { readCredentials } from '@/cli/src/lib/config'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

let fetchMock: jest.Mock
let stdout: string[]
let stderr: string[]

beforeEach(() => {
  jest.clearAllMocks()
  stdout = []
  stderr = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    stdout.push(String(s))
    return true
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

describe('formatIdeaList', () => {
  it('renders one aligned line per idea with id, status and statement', () => {
    const out = formatIdeaList([
      { identifier: 'LUM-I42', status: 'CAPTURED', statement: 'ship the pool' },
      { identifier: 'LUM-I7', status: 'PLANNED', statement: 'dark mode' },
    ])
    const lines = out.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    // Each line carries the id, its status, and the statement.
    expect(lines[0]).toContain('LUM-I42')
    expect(lines[0]).toContain('CAPTURED')
    expect(lines[0]).toContain('ship the pool')
    expect(lines[1]).toContain('LUM-I7')
    expect(lines[1]).toContain('PLANNED')
    expect(lines[1]).toContain('dark mode')
    // The id column is padded so the status column aligns across rows.
    expect(lines[0]!.indexOf('CAPTURED')).toBe(lines[1]!.indexOf('PLANNED'))
  })

  it('preserves the order it is given (server returns newest-first)', () => {
    const out = formatIdeaList([
      { identifier: 'LUM-I3', status: 'CAPTURED', statement: 'newest' },
      { identifier: 'LUM-I2', status: 'CAPTURED', statement: 'middle' },
      { identifier: 'LUM-I1', status: 'PLANNED', statement: 'oldest' },
    ])
    const lines = out.trimEnd().split('\n')
    expect(lines[0]).toContain('LUM-I3')
    expect(lines[2]).toContain('LUM-I1')
  })

  it('renders a friendly line for an empty pool', () => {
    expect(formatIdeaList([])).toBe('No ideas.\n')
  })
})

describe('lumo idea list', () => {
  it('GETs /api/ideas with the bearer token and prints the pool newest-first', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ideas: [
          { identifier: 'LUM-I9', status: 'PLANNED', statement: 'newest idea' },
          {
            identifier: 'LUM-I4',
            status: 'CAPTURED',
            statement: 'older idea',
          },
        ],
      })
    )

    const code = await ideaList()

    expect(code).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.test/api/ideas')
    expect(init.headers.Authorization).toBe('Bearer lum_x')
    const out = stdout.join('')
    // Server order is preserved: LUM-I9 (newest) prints before LUM-I4.
    expect(out.indexOf('LUM-I9')).toBeLessThan(out.indexOf('LUM-I4'))
    expect(out).toContain('PLANNED')
    expect(out).toContain('CAPTURED')
  })

  it('prints a friendly line when the pool is empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ideas: [] }))
    await ideaList()
    expect(stdout.join('')).toBe('No ideas.\n')
  })

  it('errors without hitting the network when not logged in', async () => {
    ;(readCredentials as jest.Mock).mockReturnValueOnce(null)
    const code = await ideaList()
    expect(code).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(stderr.join('')).toMatch(/not logged in/)
  })

  it('reports an auth failure on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}))
    const code = await ideaList()
    expect(code).toBe(1)
    expect(stderr.join('')).toMatch(/invalid or revoked/)
  })

  it('reports a non-ok status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}))
    const code = await ideaList()
    expect(code).toBe(1)
    expect(stderr.join('')).toMatch(/HTTP 500/)
  })
})
