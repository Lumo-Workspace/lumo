/** @jest-environment node */
import { fetchOpenCrossings } from '@/cli/src/lib/open-crossings'

const API = 'https://api.test'
const TOKEN = 'lum_x'
const TASK = 'LUM-9'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

afterEach(() => {
  jest.restoreAllMocks()
})

/**
 * LUM-480: the reader must tell a check FAILURE apart from a genuine 0-open
 * result, so a single endpoint hiccup can never read as "all clear". A success
 * returns `{ status: 'ok', crossings }`; transport / non-ok HTTP / parse errors
 * each return `{ status: 'error', reason }`.
 */
describe('fetchOpenCrossings distinguishes failure from empty (LUM-480)', () => {
  it('returns ok with the open crossings on a successful read', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        crossings: [
          {
            id: 'a',
            category: 'TEST_TAMPERING',
            severity: 'HIGH',
            detail: 'd',
            disposition: null,
          },
          {
            id: 'b',
            category: 'HARDCODED_SECRET',
            severity: 'HIGH',
            detail: 'closed',
            disposition: 'CONFIRMED',
          },
        ],
      })
    )
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('expected ok')
    // Only the undispositioned crossing survives.
    expect(result.crossings).toHaveLength(1)
    expect(result.crossings[0]!.category).toBe('TEST_TAMPERING')
  })

  it('returns ok with an EMPTY array when the read succeeds but nothing is open', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, { crossings: [] }))
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    expect(result).toEqual({ status: 'ok', crossings: [], gateEnabled: true })
  })

  it('returns ok-empty when a well-formed 200 omits the crossings field', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}))
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    expect(result).toEqual({ status: 'ok', crossings: [], gateEnabled: true })
  })

  it('returns an error sentinel on a transport failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    expect(result.status).toBe('error')
  })

  it('returns an error sentinel on a non-ok HTTP status', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}))
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    expect(result.status).toBe('error')
  })

  it('returns an error sentinel when the body is not valid JSON', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token')
      },
    } as unknown as Response)
    const result = await fetchOpenCrossings(API, TOKEN, TASK)
    expect(result.status).toBe('error')
  })
})
