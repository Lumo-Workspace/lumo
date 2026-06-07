/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/fragment-usage-api', () => ({
  fetchUsageDraft: jest.fn(),
  applyFragmentUsage: jest.fn(),
}))

import {
  FragmentUsageSection,
  parseUsedHandles,
} from '@/cli/src/commands/wrap/fragment-usage-section'
import {
  fetchUsageDraft,
  applyFragmentUsage,
} from '@/cli/src/lib/fragment-usage-api'

const fetchDraft = fetchUsageDraft as jest.Mock
const apply = applyFragmentUsage as jest.Mock
const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

const draft = {
  taskIdentifier: 'LUM-42',
  candidates: [
    { fragmentType: 'MEMORY', fragmentId: 'm1', label: '[MEMORY] "a"', used: null },
    { fragmentType: 'WEB_LINK', fragmentId: 'w1', label: '[WEB_LINK] w1', used: null },
    { fragmentType: 'MEMORY', fragmentId: 'm2', label: '[MEMORY] "b"', used: null },
  ],
  alreadyVoted: false,
}

describe('parseUsedHandles', () => {
  it('parses 1-based indices to 0-based', () => {
    expect(parseUsedHandles('1,3 5')).toEqual([0, 2, 4])
  })
  it('returns [] for "none"', () => {
    expect(parseUsedHandles('none')).toEqual([])
  })
  it('drops non-numeric / out-of-range-low tokens', () => {
    expect(parseUsedHandles('0, x, 2')).toEqual([1]) // 0→-1 dropped, x dropped, 2→1
  })
})

describe('FragmentUsageSection.prepare', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('returns false when there are no candidates', async () => {
    fetchDraft.mockResolvedValue({ taskIdentifier: null, candidates: [], alreadyVoted: false })
    const s = new FragmentUsageSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(false)
  })

  it('returns true when the session injected fragments', async () => {
    fetchDraft.mockResolvedValue(draft)
    const s = new FragmentUsageSection({ creds, sessionId: 's1' })
    expect(await s.prepare()).toBe(true)
  })
})

async function prepared(used?: string) {
  fetchDraft.mockResolvedValue(draft)
  const s = new FragmentUsageSection({ creds, sessionId: 's1', used })
  await s.prepare()
  return s
}

describe('FragmentUsageSection.run', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('with --used "1,3" posts those candidates as usedRefs', async () => {
    const s = await prepared('1,3')
    apply.mockResolvedValue({ used: 2, unused: 1 })
    await s.run({ yes: true, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', {
      usedRefs: [
        { fragmentType: 'MEMORY', fragmentId: 'm1' },
        { fragmentType: 'MEMORY', fragmentId: 'm2' },
      ],
    })
  })

  it('with --used none posts an empty usedRefs (all unused)', async () => {
    const s = await prepared('none')
    apply.mockResolvedValue({ used: 0, unused: 3 })
    await s.run({ yes: true, dryRun: false })
    expect(apply).toHaveBeenCalledWith(creds, 's1', { usedRefs: [] })
  })

  it('without --used lists candidates but does not post', async () => {
    const s = await prepared(undefined)
    await s.run({ yes: true, dryRun: false })
    expect(apply).not.toHaveBeenCalled()
  })

  it('dry-run never posts', async () => {
    const s = await prepared('1')
    await s.run({ yes: false, dryRun: true })
    expect(apply).not.toHaveBeenCalled()
  })

  it('already-voted session skips without posting', async () => {
    fetchDraft.mockResolvedValue({ ...draft, alreadyVoted: true })
    const s = new FragmentUsageSection({ creds, sessionId: 's1', used: '1' })
    await s.prepare()
    await s.run({ yes: true, dryRun: false })
    expect(apply).not.toHaveBeenCalled()
  })
})
