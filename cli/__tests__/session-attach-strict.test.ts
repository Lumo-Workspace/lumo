/**
 * @jest-environment node
 *
 * LUM-932: `lumo session attach` resolves its session strictly — when the
 * server cannot tell the main session from a running subagent, attach refuses
 * instead of binding the whole session on a guess.
 */
const mockResolve = jest.fn()
jest.mock('../src/lib/session-id', () => ({
  resolveSessionId: (...a: unknown[]) => mockResolve(...a),
}))
jest.mock('../src/lib/config', () => ({
  readCredentials: () => ({ token: 't', apiUrl: 'https://lumo.test' }),
}))

import { sessionAttach } from '../src/commands/session-attach'

const realFetch = global.fetch
afterAll(() => {
  global.fetch = realFetch
})

it('session attach asks for a strict session resolve', async () => {
  mockResolve.mockRejectedValue(new Error('cannot tell'))
  global.fetch = jest.fn() as unknown as typeof fetch
  await expect(sessionAttach('LUM-12')).rejects.toThrow('cannot tell')
  expect(mockResolve).toHaveBeenCalledWith({ write: true, strict: true })
  expect(global.fetch).not.toHaveBeenCalled()
})
