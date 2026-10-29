/**
 * LUM-1338 — the AI feature switch registry: sparse storage (absent = on),
 * three-level resolution, and the deployment gate.
 */
import {
  AI_FEATURES,
  AI_FEATURE_GROUPS,
  AI_FEATURE_KEYS,
  isAiFeature,
  isAiFeatureOn,
  isAiOffCode,
  parseAiFeatureSwitches,
  resolveAiFeatures,
  switchOn,
  withSwitch,
} from '@/lib/ai-features/registry'

describe('AI feature registry', () => {
  it('puts every feature in a known group, and every group has a feature', () => {
    for (const f of AI_FEATURE_KEYS)
      expect(AI_FEATURE_GROUPS).toContain(AI_FEATURES[f])
    for (const g of AI_FEATURE_GROUPS)
      expect(Object.values(AI_FEATURES)).toContain(g)
  })
})

describe('isAiFeature', () => {
  it('accepts own feature keys only, not inherited Object keys', () => {
    expect(isAiFeature('turnSummary')).toBe(true)
    for (const k of ['toString', 'constructor', '__proto__', 'nope'])
      expect(isAiFeature(k)).toBe(false)
  })
})

describe('parseAiFeatureSwitches', () => {
  it('keeps known boolean switches and drops everything else', () => {
    expect(
      parseAiFeatureSwitches({
        master: false,
        groups: { memory: false, bogus: false, summaries: 'no' },
        features: { turnSummary: false, nope: true },
        extra: 1,
      })
    ).toEqual({
      master: false,
      groups: { memory: false },
      features: { turnSummary: false },
    })
  })

  it('reads garbage as "all on"', () => {
    for (const raw of [null, undefined, 'x', 3, [], {}])
      expect(parseAiFeatureSwitches(raw)).toEqual({})
  })
})

describe('isAiFeatureOn', () => {
  it('is on by default when a model is configured', () => {
    expect(isAiFeatureOn({}, 'turnSummary', true)).toBe(true)
  })

  it('is off for every feature without a model', () => {
    expect(Object.values(resolveAiFeatures({}, false))).not.toContain(true)
  })

  it('needs the master, the group and the feature switch all on', () => {
    expect(isAiFeatureOn({ master: false }, 'turnSummary', true)).toBe(false)
    expect(
      isAiFeatureOn({ groups: { summaries: false } }, 'turnSummary', true)
    ).toBe(false)
    expect(
      isAiFeatureOn({ features: { turnSummary: false } }, 'turnSummary', true)
    ).toBe(false)
    // A group off leaves other groups alone.
    expect(
      isAiFeatureOn({ groups: { summaries: false } }, 'memoryRanking', true)
    ).toBe(true)
  })
})

describe('withSwitch', () => {
  it('stores off and removes on (sparse), without mutating the input', () => {
    const start = {}
    const off = withSwitch(start, { level: 'group', key: 'memory' }, false)
    expect(off).toEqual({ groups: { memory: false } })
    expect(start).toEqual({})
    expect(withSwitch(off, { level: 'group', key: 'memory' }, true)).toEqual({})
    expect(withSwitch({}, { level: 'master' }, false)).toEqual({
      master: false,
    })
    expect(
      withSwitch(
        { features: { claimCheck: false, runSummary: false } },
        { level: 'feature', key: 'claimCheck' },
        true
      )
    ).toEqual({ features: { runSummary: false } })
  })

  it('keeps a child switch position while its parent is off', () => {
    const s = withSwitch(
      { features: { duplicateCheck: false } },
      { level: 'master' },
      false
    )
    expect(switchOn(s, { level: 'feature', key: 'duplicateCheck' })).toBe(false)
    expect(switchOn(s, { level: 'feature', key: 'quickDispatch' })).toBe(true)
  })
})

describe('isAiOffCode', () => {
  it('recognises the two "AI is off here" codes only', () => {
    expect(isAiOffCode('AI_FEATURE_OFF')).toBe(true)
    expect(isAiOffCode('AI_NOT_CONFIGURED')).toBe(true)
    expect(isAiOffCode('API_ERROR')).toBe(false)
    expect(isAiOffCode(undefined)).toBe(false)
  })
})
