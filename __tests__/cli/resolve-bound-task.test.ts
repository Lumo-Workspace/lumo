/** @jest-environment node */
import { resolveBoundTaskIdentifier } from '@/cli/src/lib/resolve-bound-task'

const OLD_ENV = process.env
beforeEach(() => { process.env = { ...OLD_ENV } })
afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks() })

it('returns null when CLAUDE_CODE_SESSION_ID is unset', async () => {
  delete process.env.CLAUDE_CODE_SESSION_ID
  const r = await resolveBoundTaskIdentifier('https://x', 'tok')
  expect(r).toBeNull()
})

it('returns the bound taskIdentifier', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ taskIdentifier: 'LUM-42', taskTitle: 'T' }),
  } as Response)
  const r = await resolveBoundTaskIdentifier('https://x', 'tok')
  expect(r).toBe('LUM-42')
})

it('returns null when the session has no bound task (null identifier)', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => ({ taskIdentifier: null }),
  } as Response)
  expect(await resolveBoundTaskIdentifier('https://x', 'tok')).toBeNull()
})

it('returns null on a 404 session', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)
  expect(await resolveBoundTaskIdentifier('https://x', 'tok')).toBeNull()
})

it('returns null when fetch throws (network error)', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
  expect(await resolveBoundTaskIdentifier('https://x', 'tok')).toBeNull()
})

it('returns null when the body is not JSON', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess1'
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, json: async () => { throw new Error('bad json') },
  } as unknown as Response)
  expect(await resolveBoundTaskIdentifier('https://x', 'tok')).toBeNull()
})
