/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/session-memory-api', () => ({
  fetchMemoryDraft: jest.fn(),
  applyMemoryReview: jest.fn(),
}))
jest.mock('@/cli/src/lib/line-prompt', () => ({ promptLine: jest.fn() }))

import { formatMemoryReviewList } from '@/cli/src/lib/memory-content'

describe('formatMemoryReviewList', () => {
  it('numbers rows from 1 with [scope] category and a headline', () => {
    const out = formatMemoryReviewList([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: { trigger: 'worktree 缺软链' }, createdByMemberId: null },
      { id: 'm2', scope: 'TASK', category: 'DECISION', content: { what: '用 dynamic import' }, createdByMemberId: null },
    ])
    const lines = out.split('\n')
    expect(lines[0]).toContain('1.')
    expect(lines[0]).toContain('[TASK]')
    expect(lines[0]).toContain('TRAP')
    expect(lines[0]).toContain('worktree 缺软链')
    expect(lines[1]).toContain('2.')
    expect(lines[1]).toContain('用 dynamic import')
  })

  it('renders (unparseable) when the headline field is missing', () => {
    const out = formatMemoryReviewList([
      { id: 'm1', scope: 'TASK', category: 'TRAP', content: {}, createdByMemberId: null },
    ])
    expect(out).toContain('(unparseable)')
  })
})

import { MemoryReviewSection } from '@/cli/src/commands/wrap/memory-review-section'
import { fetchMemoryDraft, applyMemoryReview } from '@/cli/src/lib/session-memory-api'
import { promptLine } from '@/cli/src/lib/line-prompt'

const fetchDraft = fetchMemoryDraft as jest.Mock
const apply = applyMemoryReview as jest.Mock
const prompt = promptLine as jest.Mock
const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

const draft = {
  taskIdentifier: 'LUM-42',
  memories: [
    { id: 'm1', scope: 'TASK', category: 'TRAP', content: { trigger: 'a' }, createdByMemberId: null },
    { id: 'm2', scope: 'TASK', category: 'DECISION', content: { what: 'b' }, createdByMemberId: null },
    { id: 'm3', scope: 'TASK', category: 'CONVENTION', content: { rule: 'c' }, createdByMemberId: null },
  ],
  watermark: '2026-06-01T11:00:00.000Z',
}

async function prepared() {
  fetchDraft.mockResolvedValue(draft)
  const s = new MemoryReviewSection({ creds, sessionId: 's1' })
  await s.prepare()
  return s
}

describe('MemoryReviewSection.prepare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('returns false when there are no new memories', async () => {
    fetchDraft.mockResolvedValue({ taskIdentifier: 'LUM-42', memories: [], watermark: null })
    const s = new MemoryReviewSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns true when the session has new memories', async () => {
    fetchDraft.mockResolvedValue(draft)
    const s = new MemoryReviewSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(true)
  })
})

describe('MemoryReviewSection.run', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('--yes keeps all and advances the watermark with empty id lists', async () => {
    const s = await prepared()
    apply.mockResolvedValue({ deleted: 0, promoted: 0 })
    await s.run({ yes: true, dryRun: false })
    expect(prompt).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z', deleteIds: [], promoteIds: [],
    })
  })

  it('dry-run never calls apply', async () => {
    const s = await prepared()
    await s.run({ yes: false, dryRun: true })
    expect(apply).not.toHaveBeenCalled()
  })

  it('empty Enter keeps all and advances watermark', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('')
    apply.mockResolvedValue({ deleted: 0, promoted: 0 })
    await s.run({ yes: false, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z', deleteIds: [], promoteIds: [],
    })
  })

  it('s skips the section without advancing watermark', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('s')
    await s.run({ yes: false, dryRun: false })
    expect(apply).not.toHaveBeenCalled()
  })

  it('parses "d 1,3 p 2" into the right id lists', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('d 1,3 p 2')
    apply.mockResolvedValue({ deleted: 2, promoted: 1 })
    await s.run({ yes: false, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z',
      deleteIds: ['m1', 'm3'],
      promoteIds: ['m2'],
    })
  })

  it('ignores out-of-range indices', async () => {
    const s = await prepared()
    prompt.mockResolvedValueOnce('d 9')
    apply.mockResolvedValue({ deleted: 0, promoted: 0 })
    await s.run({ yes: false, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      watermark: '2026-06-01T11:00:00.000Z', deleteIds: [], promoteIds: [],
    })
  })
})
