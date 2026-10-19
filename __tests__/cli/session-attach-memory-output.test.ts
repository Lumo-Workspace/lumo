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

// LUM-844: attach no longer prints memory or the test-case nudge — `task
// context` (the next workflow step) does; attach points at it in one line.
describe('lumo session attach — memorySection stdout', () => {
  it('leaves memorySection and testCaseSection to task context and points there', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        taskId: 'task-1',
        taskIdentifier: 'LUM-42',
        taskTitle: 'T',
        retaggedEventCount: 0,
        memorySection: '## Relevant Memory\n\n- [task] X\n',
        testCaseSection: '## Test cases\n\nNo test cases on this task yet.',
      }),
    } as Response)

    await sessionAttach('LUM-42')

    const outputs = consoleLogSpy.mock.calls.map(c => String(c[0]))
    expect(outputs.some(o => o.includes('Attached session'))).toBe(true)
    expect(outputs.some(o => o.includes('## Relevant Memory'))).toBe(false)
    expect(outputs.some(o => o.includes('## Test cases'))).toBe(false)
    expect(outputs).toContain(
      'Hint: run `lumo task show LUM-42 --full` for background (team memory, test cases, sources, prior sessions)'
    )

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
    // Exactly 3 calls: bind line (no retag clause at 0) + blank + context pointer
    expect(consoleLogSpy.mock.calls.length).toBe(3)
    expect(outputs[0]).not.toContain('re-tagged')

    fetchSpy.mockRestore()
  })
})
