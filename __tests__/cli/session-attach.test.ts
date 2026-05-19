/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('@/cli/src/lib/session-binding', () => ({
  writeSessionBinding: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { writeSessionBinding } from '@/cli/src/lib/session-binding'
import { sessionAttach } from '@/cli/src/commands/session-attach'

const mockRead = readCredentials as jest.Mock
const mockWrite = writeSessionBinding as jest.Mock

const originalEnv = process.env.CLAUDE_CODE_SESSION_ID
let consoleErrorSpy: jest.SpyInstance
let consoleLogSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'http://x',
    workspaceSlug: 'lumo',
  })
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  consoleLogSpy.mockRestore()
  if (originalEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = originalEnv
})

describe('sessionAttach', () => {
  it('exits 1 when CLAUDE_CODE_SESSION_ID env is not set', async () => {
    const exit = await sessionAttach('LUM-42')
    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CLAUDE_CODE_SESSION_ID')
    )
  })

  it('exits 1 when identifier is missing', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const exit = await sessionAttach(undefined)
    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('exits 1 when credentials are missing', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    mockRead.mockReturnValue(null)
    const exit = await sessionAttach('LUM-42')
    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it('POSTs to /api/sessions/<sid>/bind-task and writes per-session file on 200', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        taskId: 'task_1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'Fix bug',
        retaggedEventCount: 3,
      }),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://x/api/sessions/S1/bind-task',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ taskIdentifier: 'LUM-42' }),
      })
    )
    expect(mockWrite).toHaveBeenCalledWith(
      'S1',
      expect.objectContaining({
        taskId: 'task_1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'Fix bug',
        workspaceSlug: 'lumo',
      })
    )
    fetchSpy.mockRestore()
  })

  it('exits 1 and does not write file when server returns 404', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Task LUM-999 not found in workspace' }),
    } as Response)

    const exit = await sessionAttach('LUM-999')

    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('exits 1 and does not write file when server returns 401', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('exits 1 and does not write file when fetch throws', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'))

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    expect(mockWrite).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
