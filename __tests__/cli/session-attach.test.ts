/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({
  promptLine: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { promptLine } from '@/cli/src/lib/line-prompt'
import { sessionAttach } from '@/cli/src/commands/session-attach'

const mockRead = readCredentials as jest.Mock
const mockPrompt = promptLine as jest.Mock

/** Stub the TTY flag on process.stdin for the duration of one test. */
function withTTY(isTTY: boolean, fn: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  Object.defineProperty(process.stdin, 'isTTY', {
    value: isTTY,
    configurable: true,
  })
  return fn().finally(() => {
    if (original) Object.defineProperty(process.stdin, 'isTTY', original)
    else delete (process.stdin as { isTTY?: boolean }).isTTY
  })
}

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
        body: JSON.stringify({ taskIdentifier: 'LUM-42', force: false }),
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

  // LUM-266: override-confirmation when already bound to a different task.
  const alreadyBound = {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'already-bound',
      currentTaskIdentifier: 'LUM-7',
      currentTaskTitle: 'Other task',
    }),
  } as Response

  const boundOk = (identifier: string) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'bound',
        taskId: 'task_x',
        taskIdentifier: identifier,
        taskTitle: 'New task',
        retaggedEventCount: 0,
        memorySection: '',
      }),
    }) as Response

  it('refuses to overwrite (no second POST) off a TTY when already bound', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(alreadyBound)

    await withTTY(false, async () => {
      const exit = await sessionAttach('LUM-42')
      expect(exit).toBe(0)
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mockPrompt).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--force')
    )
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Attached session')
    )
    fetchSpy.mockRestore()
  })

  it('prompts on a TTY and re-binds with force:true when the user confirms', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    mockPrompt.mockResolvedValue('y')
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(alreadyBound)
      .mockResolvedValueOnce(boundOk('LUM-42'))

    await withTTY(true, async () => {
      const exit = await sessionAttach('LUM-42')
      expect(exit).toBeUndefined()
    })

    expect(mockPrompt).toHaveBeenCalledWith(
      expect.stringContaining('已绑定 LUM-7')
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenLastCalledWith(
      'https://x/api/sessions/S1/bind-task',
      expect.objectContaining({
        body: JSON.stringify({ taskIdentifier: 'LUM-42', force: true }),
      })
    )
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Attached session S1 to LUM-42')
    )
    fetchSpy.mockRestore()
  })

  it('cancels (no second POST) on a TTY when the user declines', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    mockPrompt.mockResolvedValue('') // bare Enter → default No
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(alreadyBound)

    await withTTY(true, async () => {
      const exit = await sessionAttach('LUM-42')
      expect(exit).toBe(0)
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('已取消')
    )
    fetchSpy.mockRestore()
  })

  it('with --force, sends force:true on the first POST and skips the prompt', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = 'S1'
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(boundOk('LUM-42'))

    const exit = await sessionAttach('LUM-42', { force: true })

    expect(exit).toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://x/api/sessions/S1/bind-task',
      expect.objectContaining({
        body: JSON.stringify({ taskIdentifier: 'LUM-42', force: true }),
      })
    )
    expect(mockPrompt).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
