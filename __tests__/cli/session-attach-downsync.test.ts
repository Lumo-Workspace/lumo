/**
 * @jest-environment node
 *
 * LUM-551 — `session attach` triggers a best-effort downsync after a 2xx bind;
 * a sync failure never changes the attach's exit code.
 */
// LUM-825: the local worktree step shells out to git against the real
// checkout; these suites test the bind output, so keep it inert here.
jest.mock('@/cli/src/lib/worktree-attach', () => ({
  attachWorktreeStep: jest.fn(),
}))
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/resolve-project', () => ({
  resolveBoundProjectId: jest.fn(),
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoDownsyncOnAttach: jest.fn(),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { resolveBoundProjectId } from '@/cli/src/lib/resolve-project'
import { autoDownsyncOnAttach } from '@/cli/src/lib/memory-auto'
import { sessionAttach } from '@/cli/src/commands/session-attach'

const mockCreds = readCredentials as jest.Mock
const mockResolve = resolveBoundProjectId as jest.Mock
const mockDownsync = autoDownsyncOnAttach as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
  mockCreds.mockReturnValue({ token: 't', apiUrl: 'https://api.example.com' })
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      taskId: 'tid',
      taskIdentifier: 'LUM-551',
      taskTitle: 'x',
      retaggedEventCount: 0,
      memorySection: '',
    }),
  }) as unknown as typeof fetch
  mockResolve.mockResolvedValue({ ok: true, id: 'p1' })
  mockDownsync.mockResolvedValue({
    added: 1,
    updated: 0,
    removed: 0,
    anchorCandidates: 0,
  })
})
afterEach(() => {
  delete process.env.CLAUDE_CODE_SESSION_ID
})

it('runs the downsync with the resolved project after a successful bind', async () => {
  const rc = await sessionAttach('LUM-551')
  expect(rc).toBeUndefined() // attach success returns void
  expect(mockResolve).toHaveBeenCalledWith(
    'https://api.example.com',
    't',
    'LUM-551'
  )
  expect(mockDownsync).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: 'p1', token: 't' })
  )
})

it('does not fail the attach when the downsync throws', async () => {
  mockDownsync.mockRejectedValue(new Error('sync exploded'))
  await expect(sessionAttach('LUM-551')).resolves.toBeUndefined()
})

it('skips the downsync when the project cannot be resolved', async () => {
  mockResolve.mockResolvedValue({ ok: false, error: 'no project' })
  await expect(sessionAttach('LUM-551')).resolves.toBeUndefined()
  expect(mockDownsync).not.toHaveBeenCalled()
})
