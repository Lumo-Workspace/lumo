/**
 * @jest-environment node
 */

jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/hook-log', () => ({ logHookError: jest.fn() }))

import { runHookWithBody } from '@/cli/src/lib/hook-runner'
import { readCredentials } from '@/cli/src/lib/config'
import { logHookError } from '@/cli/src/lib/hook-log'

const mockRead = readCredentials as jest.Mock
const mockLog = logHookError as jest.Mock
const CREDS = { token: 't', apiUrl: 'https://www.uselumo.ai' }
const ORIGINAL_ENV = process.env.LUMO_API_URL

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.LUMO_API_URL
  else process.env.LUMO_API_URL = ORIGINAL_ENV
  jest.restoreAllMocks()
  jest.clearAllMocks()
})

it('skips the POST and logs (exit 0) when LUMO_API_URL is an insecure remote host', async () => {
  process.env.LUMO_API_URL = 'http://evil.com'
  mockRead.mockReturnValue(CREDS)
  const fetchSpy = jest.spyOn(global, 'fetch')

  // Must NOT throw — the hook always exits 0 so Claude Code is never blocked.
  await expect(
    runHookWithBody('user-prompt-submit', '{}')
  ).resolves.toBeUndefined()

  expect(fetchSpy).not.toHaveBeenCalled()
  expect(mockLog).toHaveBeenCalled()
})

it('routes the host-mismatch warning to hook.log, not stdout, and still POSTs', async () => {
  process.env.LUMO_API_URL = 'https://staging.uselumo.ai'
  mockRead.mockReturnValue(CREDS)
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: true, status: 200 } as Response)
  const stdoutSpy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)

  await runHookWithBody('user-prompt-submit', '{}')

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(fetchSpy.mock.calls[0]![0]).toBe(
    'https://staging.uselumo.ai/api/hooks/user-prompt-submit'
  )
  // The ⚠ warning goes to hook.log, never stdout (which feeds Claude Code).
  const warned = mockLog.mock.calls.some(c =>
    String(c[1]).includes('staging.uselumo.ai')
  )
  expect(warned).toBe(true)
  expect(stdoutSpy).not.toHaveBeenCalled()
})
