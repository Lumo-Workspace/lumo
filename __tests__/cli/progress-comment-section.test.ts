/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/progress-comment-api', () => ({
  fetchProgressDraft: jest.fn(),
  postProgressComment: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({ promptLine: jest.fn() }))
jest.mock('@/cli/src/lib/editor', () => ({ editInEditor: jest.fn() }))

import {
  formatProgressBody,
  ProgressCommentSection,
} from '@/cli/src/commands/wrap/progress-comment-section'
import { fetchProgressDraft, postProgressComment } from '@/cli/src/lib/progress-comment-api'
import { promptLine } from '@/cli/src/lib/line-prompt'
import { editInEditor } from '@/cli/src/lib/editor'

const fetchDraft = fetchProgressDraft as jest.Mock
const post = postProgressComment as jest.Mock
const prompt = promptLine as jest.Mock
const edit = editInEditor as jest.Mock
const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => jest.restoreAllMocks())

describe('formatProgressBody', () => {
  it('builds a bulleted body under the section header', () => {
    expect(formatProgressBody(['changed a.ts', 'ran tests'])).toBe('Session progress\n- changed a.ts\n- ran tests')
  })
})

describe('ProgressCommentSection.prepare', () => {
  it('returns false when there is no bound task', async () => {
    fetchDraft.mockResolvedValue({ taskIdentifier: null, taskTitle: null, summaries: [], watermark: null })
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns false when there are no unposted summaries', async () => {
    fetchDraft.mockResolvedValue({ taskIdentifier: 'LUM-42', taskTitle: 'T', summaries: [], watermark: null })
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns true and stores a draft when there are summaries', async () => {
    fetchDraft.mockResolvedValue({
      taskIdentifier: 'LUM-42', taskTitle: 'T',
      summaries: [{ id: 'e1', turnSummary: 'changed a.ts', createdAt: '2026-06-01T10:00:00.000Z' }],
      watermark: '2026-06-01T10:00:00.000Z',
    })
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(true)
  })
})

describe('ProgressCommentSection.run', () => {
  const draft = {
    taskIdentifier: 'LUM-42', taskTitle: 'T',
    summaries: [{ id: 'e1', turnSummary: 'changed a.ts', createdAt: '2026-06-01T10:00:00.000Z' }],
    watermark: '2026-06-01T10:00:00.000Z',
  }
  async function prepared() {
    fetchDraft.mockResolvedValue(draft)
    const s = new ProgressCommentSection({ creds, sessionId: 's1' })
    await s.prepare()
    return s
  }

  it('--yes posts the drafted body without prompting', async () => {
    const s = await prepared()
    post.mockResolvedValue({ commentId: 'c1' })
    await s.run({ yes: true, dryRun: false })
    expect(prompt).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(creds, 's1', {
      body: 'Session progress\n- changed a.ts',
      watermark: '2026-06-01T10:00:00.000Z',
    })
  })

  it('dry-run never posts', async () => {
    const s = await prepared()
    await s.run({ yes: false, dryRun: true })
    expect(post).not.toHaveBeenCalled()
  })

  it('y posts, s skips, e edits then posts', async () => {
    // y
    let s = await prepared()
    prompt.mockResolvedValueOnce('y')
    post.mockResolvedValue({ commentId: 'c1' })
    await s.run({ yes: false, dryRun: false })
    expect(post).toHaveBeenCalledTimes(1)

    // s (skip)
    post.mockClear()
    s = await prepared()
    prompt.mockResolvedValueOnce('s')
    await s.run({ yes: false, dryRun: false })
    expect(post).not.toHaveBeenCalled()

    // e (edit → then confirm y)
    post.mockClear()
    s = await prepared()
    prompt.mockResolvedValueOnce('e').mockResolvedValueOnce('y')
    edit.mockResolvedValue('Session progress\n- changed a.ts (edited)')
    await s.run({ yes: false, dryRun: false })
    expect(edit).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(creds, 's1', {
      body: 'Session progress\n- changed a.ts (edited)',
      watermark: '2026-06-01T10:00:00.000Z',
    })
  })
})
