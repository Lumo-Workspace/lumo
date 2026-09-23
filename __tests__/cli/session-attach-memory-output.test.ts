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
let consoleLogSpy: jest.SpyInstance
let consoleErrorSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CLAUDE_CODE_SESSION_ID = 's-1'
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleLogSpy.mockRestore()
  consoleErrorSpy.mockRestore()
  if (originalEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = originalEnv
})

describe('lumo session attach — memorySection stdout', () => {
  it('prints memorySection on its own line when non-empty', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        taskId: 'task-1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'T',
        retaggedEventCount: 0,
        memorySection: '## Relevant Memory\n\n- [task] X\n',
      }),
    } as Response)

    await sessionAttach('LUM-42')

    const outputs = consoleLogSpy.mock.calls.map(c => String(c[0]))
    expect(outputs.some(o => o.includes('Attached session'))).toBe(true)
    expect(outputs.some(o => o.includes('## Relevant Memory'))).toBe(true)

    fetchSpy.mockRestore()
  })

  it('does not print memory block when memorySection is empty', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        taskId: 'task-1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'T',
        retaggedEventCount: 0,
        memorySection: '',
      }),
    } as Response)

    await sessionAttach('LUM-42')

    const outputs = consoleLogSpy.mock.calls.map(c => String(c[0]))
    expect(outputs.some(o => o.includes('## Relevant Memory'))).toBe(false)
    // Should be exactly 2 calls: bind line + retag line — no blank line + no empty section
    expect(consoleLogSpy.mock.calls.length).toBe(2)

    fetchSpy.mockRestore()
  })
})
