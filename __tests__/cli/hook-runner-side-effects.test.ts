/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/session-binding', () => ({
  readSessionBinding: jest.fn().mockReturnValue(null),
  cleanupStaleBindings: jest.fn(),
  clearSessionBinding: jest.fn(),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn().mockReturnValue({
    token: 't',
    apiUrl: 'http://x',
    workspaceSlug: 'w',
  }),
}))
jest.mock('@/cli/src/lib/hook-log', () => ({
  logHookError: jest.fn(),
}))

import { runHookWithBody } from '@/cli/src/lib/hook-runner'
import {
  cleanupStaleBindings,
  clearSessionBinding,
} from '@/cli/src/lib/session-binding'

// Pull the mock-fn identities out of the mocked module so assertions reference
// the same jest.fn() instances the runner actually called. This is the
// canonical pattern for verifying calls on functions whose binding lives
// inside a hoisted jest.mock factory.
const cleanup = cleanupStaleBindings as jest.Mock
const clear = clearSessionBinding as jest.Mock

const originalFetch = global.fetch

beforeEach(() => {
  cleanup.mockReset()
  clear.mockReset()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }) as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = originalFetch
})

describe('runHookWithBody side effects', () => {
  it('calls cleanupStaleBindings(7) after a successful session-start POST', async () => {
    await runHookWithBody('session-start', '{"session_id":"S1"}')
    expect(cleanup).toHaveBeenCalledWith(7)
    expect(clear).not.toHaveBeenCalled()
  })

  it('calls clearSessionBinding(sessionId) after a successful session-end POST', async () => {
    await runHookWithBody('session-end', '{"session_id":"S1"}')
    expect(clear).toHaveBeenCalledWith('S1')
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does not call clearSessionBinding when session-end has no session_id', async () => {
    await runHookWithBody('session-end', '{}')
    expect(clear).not.toHaveBeenCalled()
  })

  it('does not call side effects when POST failed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch
    await runHookWithBody('session-end', '{"session_id":"S1"}')
    expect(clear).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('does not call cleanup or clear for unrelated hook types', async () => {
    await runHookWithBody('pre-tool-use', '{"session_id":"S1"}')
    expect(cleanup).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })
})
