/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/wrap-panel', () => ({ runWrapPanel: jest.fn() }))
jest.mock('@/cli/src/commands/wrap/progress-comment-section', () => ({
  ProgressCommentSection: jest.fn().mockImplementation(() => ({ tag: 'progress' })),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { runWrapPanel } from '@/cli/src/lib/wrap-panel'
import { ProgressCommentSection } from '@/cli/src/commands/wrap/progress-comment-section'
import { sessionWrap } from '@/cli/src/commands/session-wrap'

const mockRead = readCredentials as jest.Mock
const mockRun = runWrapPanel as jest.Mock
const originalEnv = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  mockRead.mockReturnValue({ token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  jest.restoreAllMocks()
  if (originalEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
  else process.env.CLAUDE_CODE_SESSION_ID = originalEnv
})

it('exits 1 when CLAUDE_CODE_SESSION_ID is not set', async () => {
  const code = await sessionWrap({})
  expect(code).toBe(1)
  expect(mockRun).not.toHaveBeenCalled()
})

it('exits 1 when not logged in', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  mockRead.mockReturnValue(null)
  const code = await sessionWrap({})
  expect(code).toBe(1)
})

it('runs the panel with a ProgressCommentSection and passes opts', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  await sessionWrap({ yes: true })
  expect(ProgressCommentSection).toHaveBeenCalledWith({
    creds: { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' },
    sessionId: 'sess_1',
  })
  expect(mockRun).toHaveBeenCalledWith([{ tag: 'progress' }], { yes: true, dryRun: false })
})
