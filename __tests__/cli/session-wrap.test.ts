/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/wrap-panel', () => ({ runWrapPanel: jest.fn() }))
jest.mock('@/cli/src/commands/wrap/memory-review-section', () => ({
  MemoryReviewSection: jest.fn().mockImplementation(() => ({ tag: 'review' })),
}))
jest.mock('@/cli/src/commands/wrap/fragment-usage-section', () => ({
  FragmentUsageSection: jest.fn().mockImplementation(() => ({ tag: 'usage' })),
}))
jest.mock('@/cli/src/commands/wrap/blocked-prompt-section', () => ({
  BlockedPromptSection: jest
    .fn()
    .mockImplementation(() => ({ tag: 'blocked' })),
}))
jest.mock('@/cli/src/commands/wrap/crossings-reminder', () => ({
  openCrossingReminder: jest.fn(async () => null),
}))

import { readCredentials } from '@/cli/src/lib/config'
import { openCrossingReminder } from '@/cli/src/commands/wrap/crossings-reminder'
import { runWrapPanel } from '@/cli/src/lib/wrap-panel'
import { MemoryReviewSection } from '@/cli/src/commands/wrap/memory-review-section'
import { FragmentUsageSection } from '@/cli/src/commands/wrap/fragment-usage-section'
import { BlockedPromptSection } from '@/cli/src/commands/wrap/blocked-prompt-section'
import { sessionWrap } from '@/cli/src/commands/session-wrap'

const mockRead = readCredentials as jest.Mock
const mockRun = runWrapPanel as jest.Mock
const originalEnv = process.env.CLAUDE_CODE_SESSION_ID

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CLAUDE_CODE_SESSION_ID
  mockRead.mockReturnValue({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
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

it('runs the panel with memory-review + fragment-usage + blocked-prompt sections and passes opts', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  await sessionWrap({ yes: true, used: '1,3' })
  const expectedArgs = {
    creds: { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' },
    sessionId: 'sess_1',
  }
  expect(MemoryReviewSection).toHaveBeenCalledWith(expectedArgs)
  expect(FragmentUsageSection).toHaveBeenCalledWith({
    ...expectedArgs,
    used: '1,3',
  })
  expect(BlockedPromptSection).toHaveBeenCalledWith(expectedArgs)
  expect(mockRun).toHaveBeenCalledWith(
    [{ tag: 'review' }, { tag: 'usage' }, { tag: 'blocked' }],
    { yes: true, dryRun: false }
  )
})

it('consults the open-crossings reminder after the panel and prints it when present', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  const mockReminder = openCrossingReminder as jest.Mock
  mockReminder.mockResolvedValueOnce('⚠ 2 open boundary crossings on LUM-9\n')
  const writeSpy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)
  await sessionWrap({ yes: true })
  expect(mockReminder).toHaveBeenCalledWith({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })
  const out = writeSpy.mock.calls.map(c => c[0]).join('')
  expect(out).toContain('2 open boundary crossings on LUM-9')
})

it('prints nothing extra when there are no open crossings (silent)', async () => {
  process.env.CLAUDE_CODE_SESSION_ID = 'sess_1'
  ;(openCrossingReminder as jest.Mock).mockResolvedValueOnce(null)
  const writeSpy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true)
  await sessionWrap({ yes: true })
  const out = writeSpy.mock.calls.map(c => c[0]).join('')
  expect(out).not.toContain('boundary crossing')
})
