/**
 * @jest-environment node
 *
 * LUM-1303: `lumo task decide` endpoint. Only a CLI that prefixed the local
 * date (≤ 2.0.0) gets that prefix stripped; any other caller's text is kept,
 * even when it starts with a date.
 */
const verifyBearer = jest.fn()
jest.mock('@/lib/auth/bearer', () => ({
  verifyBearer: (...a: unknown[]) => verifyBearer(...a),
}))
const recordFromCli = jest.fn()
jest.mock('@/lib/services/task-decision.service', () => ({
  taskDecisionService: {
    recordFromCli: (...a: unknown[]) => recordFromCli(...a),
  },
}))

import { POST } from '@/app/api/tasks/by-identifier/[identifier]/decisions/route'

const params = { params: Promise.resolve({ identifier: 'LUM-42' }) }
const req = (
  headers: Record<string, string> = {},
  body: unknown = { text: 'x' }
) =>
  new Request('http://x/api/tasks/by-identifier/LUM-42/decisions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  verifyBearer.mockResolvedValue({
    user: { id: 'clerk_1' },
    workspace: { id: 'ws_1', slug: 'lumo' },
  })
  recordFromCli.mockResolvedValue({
    task: { identifier: 'LUM-42', title: 'T', url: 'u' },
    decision: { number: 5 },
  })
})

describe('POST /api/tasks/by-identifier/[identifier]/decisions', () => {
  it.each([
    ['2.0.0', true],
    ['1.98.3', true],
    ['2.0.1', false],
    ['2.1.0', false],
    ['3.0.0', false],
  ])('CLI %s → strip the date prefix: %s', async (version, strip) => {
    const res = await POST(req({ 'X-Lumo-Cli-Version': version }), params)
    expect(res.status).toBe(201)
    expect(recordFromCli).toHaveBeenCalledWith(
      expect.objectContaining({ stripLegacyDatePrefix: strip })
    )
  })

  it('no (or an unparsable) version header keeps the text as written', async () => {
    await POST(req(), params)
    await POST(req({ 'X-Lumo-Cli-Version': 'dev' }), params)
    for (const call of recordFromCli.mock.calls) {
      expect(call[0]).toMatchObject({ stripLegacyDatePrefix: false })
    }
  })

  it('returns the decision number and passes the session and rationale through', async () => {
    const res = await POST(
      req(
        { 'X-Lumo-Session-Id': 'sess_1' },
        { text: 'keep v1', rationale: 'why' }
      ),
      params
    )
    expect(await res.json()).toMatchObject({ decision: { number: 5 } })
    expect(recordFromCli).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'LUM-42',
        text: 'keep v1',
        rationale: 'why',
        sourceSessionId: 'sess_1',
      })
    )
  })

  it('401 without a valid key; 400 on empty text', async () => {
    verifyBearer.mockResolvedValueOnce(null)
    expect((await POST(req(), params)).status).toBe(401)
    expect((await POST(req({}, { text: ' ' }), params)).status).toBe(400)
    expect(recordFromCli).not.toHaveBeenCalled()
  })
})
