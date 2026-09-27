// Mock the gateway + ai BEFORE importing the module under test so the real
// @ai-sdk/gateway (TransformStream) never loads in jest.
const mockGenerateObject = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: any[]) => mockGenerateObject(...a),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  canonicalizeToEnglish,
  containsCjk,
} from '@/lib/services/memory/canonicalize-language'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('containsCjk', () => {
  it('detects Chinese characters', () => {
    expect(containsCjk('手动 add 绕过 reconcile')).toBe(true)
  })
  it('returns false for pure ASCII/English', () => {
    expect(containsCjk('Manual add bypasses reconcile')).toBe(false)
  })
})

describe('canonicalizeToEnglish', () => {
  it('returns English content unchanged WITHOUT calling the LLM', async () => {
    const content = { trigger: 'Merging a schema PR', outcome: 'prod drifts' }
    const out = await canonicalizeToEnglish('TRAP', content)
    expect(out).toBe(content)
    expect(mockGenerateObject).not.toHaveBeenCalled()
  })

  it('translates Chinese content to English via the LLM', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { trigger: 'Merging a schema PR', outcome: 'prod schema drifts' },
    })
    const out = await canonicalizeToEnglish('TRAP', {
      trigger: '合并 schema PR',
      outcome: '生产 schema 漂移',
    })
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    expect(out).toEqual({
      trigger: 'Merging a schema PR',
      outcome: 'prod schema drifts',
    })
  })

  it('fail-open: returns the ORIGINAL content when the LLM throws', async () => {
    mockGenerateObject.mockRejectedValue(new Error('gateway down'))
    const original = { trigger: '合并 schema PR', outcome: '生产漂移' }
    const out = await canonicalizeToEnglish('TRAP', original)
    expect(out).toBe(original)
  })

  it('fail-open: returns the ORIGINAL content when the translation fails schema validation', async () => {
    // Missing required `outcome` → parseMemoryContent throws → keep original.
    mockGenerateObject.mockResolvedValue({
      object: { trigger: 'only trigger' },
    })
    const original = { trigger: '触发', outcome: '后果' }
    const out = await canonicalizeToEnglish('TRAP', original)
    expect(out).toBe(original)
  })
})
