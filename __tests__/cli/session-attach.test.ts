/**
 * @jest-environment node
 */
// LUM-825: the local worktree step shells out to git against the real
// checkout; these suites test the bind output, so keep it inert here.
jest.mock('@/cli/src/lib/worktree-attach', () => ({
  attachWorktreeStep: jest.fn(),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { sessionAttach } from '@/cli/src/commands/session-attach'

const mockRead = readCredentials as jest.Mock

const originalEnv = process.env.CLAUDE_CODE_SESSION_ID
let consoleErrorSpy: jest.SpyInstance
let consoleLogSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
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
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CLAUDE_CODE_SESSION_ID')
    )
  })

  it('exits 1 when identifier is missing', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const exit = await sessionAttach(undefined)
    expect(exit).toBe(1)
  })

  it('exits 1 when credentials are missing', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    mockRead.mockReturnValue(null)
    const exit = await sessionAttach('LUM-42')
    expect(exit).toBe(1)
  })

  it('POSTs to /api/sessions/<sid>/bind-task on 200', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        taskId: 'task_1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'Fix bug',
        retaggedEventCount: 3,
        memorySection: '',
      }),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://x/api/sessions/S1/bind-task',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ taskIdentifier: 'LUM-42' }),
      })
    )
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Attached session S1 to LUM-42')
    )
    fetchSpy.mockRestore()
  })

  it('exits 1 when server returns 404', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Task LUM-999 not found in workspace' }),
    } as Response)

    const exit = await sessionAttach('LUM-999')

    expect(exit).toBe(1)
    fetchSpy.mockRestore()
  })

  it('exits 1 when server returns 401', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    fetchSpy.mockRestore()
  })

  it('exits 1 when fetch throws', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'))

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    fetchSpy.mockRestore()
  })

  it('attach rejects --force and exits 1 with the lifetime-lock message on 409', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Session is permanently bound to LUM-7',
        currentTaskIdentifier: 'LUM-7',
        currentTaskTitle: 'Other task',
      }),
    } as Response)

    const exit = await sessionAttach('LUM-42')

    expect(exit).toBe(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('LUM-7')
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('new Claude Code or Codex session')
    )
    // The remedy names the task the user was trying to attach to.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('LUM-42')
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://x/api/sessions/S1/bind-task',
      expect.objectContaining({
        body: JSON.stringify({ taskIdentifier: 'LUM-42' }),
      })
    )
    fetchSpy.mockRestore()
  })
})
