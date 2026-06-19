/**
 * @jest-environment node
 *
 * LUM-551 — the session-end/stop/task-completed hooks drain the upsync outbox;
 * other paths do not. The hook's exit-0 contract is unaffected by a drain throw.
 */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoUpsyncOnDrain: jest.fn(),
  autoDownsyncOnAttach: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { autoUpsyncOnDrain } from '@/cli/src/lib/memory-auto'
import { runHookWithBody } from '@/cli/src/lib/hook-runner'

const mockCreds = readCredentials as jest.Mock
const mockDrain = autoUpsyncOnDrain as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({ token: 't', apiUrl: 'https://api.example.com' })
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }) as unknown as typeof fetch
  mockDrain.mockResolvedValue({ skipped: 'empty' })
})

it.each(['stop', 'session-end', 'task-completed'] as const)(
  'drains the outbox on the %s hook',
  async path => {
    await runHookWithBody(path, '{}')
    expect(mockDrain).toHaveBeenCalledTimes(1)
  }
)

it('does not drain on a non-lifecycle hook (post-tool-use)', async () => {
  await runHookWithBody('post-tool-use', '{}')
  expect(mockDrain).not.toHaveBeenCalled()
})

it('still resolves (exit 0) when the drain throws', async () => {
  mockDrain.mockRejectedValue(new Error('drain boom'))
  await expect(runHookWithBody('stop', '{}')).resolves.toBeUndefined()
})
