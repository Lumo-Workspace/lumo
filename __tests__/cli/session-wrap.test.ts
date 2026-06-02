/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/wrap-panel', () => ({ runWrapPanel: jest.fn() }))
jest.mock('@/cli/src/commands/wrap/progress-comment-section', () => ({
  ProgressCommentSection: jest.fn().mockImplementation(() => ({ tag: 'progress' })),
}))
jest.mock('@/cli/src/commands/wrap/memory-review-section', () => ({
  MemoryReviewSection: jest.fn().mockImplementation(() => ({ tag: 'review' })),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { runWrapPanel } from '@/cli/src/lib/wrap-panel'
import { ProgressCommentSection } from '@/cli/src/commands/wrap/progress-comment-section'
import { MemoryReviewSection } from '@/cli/src/commands/wrap/memory-review-section'
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

it('runs the panel with a progress + memory-review section and passes opts', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  await sessionWrap({ yes: true })
  const expectedArgs = {
    creds: { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' },
    sessionId: 'sess_1',
  }
  expect(ProgressCommentSection).toHaveBeenCalledWith(expectedArgs)
  expect(MemoryReviewSection).toHaveBeenCalledWith(expectedArgs)
  expect(mockRun).toHaveBeenCalledWith([{ tag: 'progress' }, { tag: 'review' }], {
    yes: true,
    dryRun: false,
  })
})
