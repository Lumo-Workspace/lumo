/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/failure-summary-api', () => ({
  fetchFailureSummary: jest.fn(),
  markTaskBlocked: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({ promptLine: jest.fn() }))

import { BlockedPromptSection } from '@/cli/src/commands/wrap/blocked-prompt-section'
import {
  fetchFailureSummary,
  markTaskBlocked,
} from '@/cli/src/lib/failure-summary-api'
import { promptLine } from '@/cli/src/lib/line-prompt'

const fetchDraft = fetchFailureSummary as jest.Mock
const mark = markTaskBlocked as jest.Mock
const prompt = promptLine as jest.Mock
const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

const promptDraft = {
  taskIdentifier: 'LUM-42',
  taskTitle: 'T',
  topFailure: { label: 'Bash', count: 3, lastErrorSummary: 'command not found' },
  alreadyBlocked: false,
  shouldPrompt: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => jest.restoreAllMocks())

describe('BlockedPromptSection.prepare', () => {
  it('returns false when the server says not to prompt', async () => {
    fetchDraft.mockResolvedValue({ ...promptDraft, shouldPrompt: false })
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns true when the server says to prompt', async () => {
    fetchDraft.mockResolvedValue(promptDraft)
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(true)
  })
})

describe('BlockedPromptSection.run', () => {
  it('does not mark on dry-run', async () => {
    fetchDraft.mockResolvedValue(promptDraft)
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    await s.prepare()
    await s.run({ yes: false, dryRun: true })
    expect(mark).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('does NOT auto-tag under --yes (no silent board mutation), and does not prompt', async () => {
    fetchDraft.mockResolvedValue(promptDraft)
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    await s.prepare()
    await s.run({ yes: true, dryRun: false })
    expect(mark).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('marks blocked when the user answers y', async () => {
    fetchDraft.mockResolvedValue(promptDraft)
    prompt.mockResolvedValue('y')
    mark.mockResolvedValue({ taskIdentifier: 'LUM-42', tag: 'blocked' })
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    await s.prepare()
    await s.run({ yes: false, dryRun: false })
    expect(mark).toHaveBeenCalledWith(creds, 's1')
  })

  it('skips (no mark) when the user answers s', async () => {
    fetchDraft.mockResolvedValue(promptDraft)
    prompt.mockResolvedValue('s')
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    await s.prepare()
    await s.run({ yes: false, dryRun: false })
    expect(mark).not.toHaveBeenCalled()
  })

  it('skips (no mark) on empty input — default is do-nothing', async () => {
    fetchDraft.mockResolvedValue(promptDraft)
    prompt.mockResolvedValue('')
    const s = new BlockedPromptSection({ creds, sessionId: 's1' })
    await s.prepare()
    await s.run({ yes: false, dryRun: false })
    expect(mark).not.toHaveBeenCalled()
  })
})
