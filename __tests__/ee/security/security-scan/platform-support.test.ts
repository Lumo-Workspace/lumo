/** LUM-1318 — which scan layers a platform's capabilities allow (PURE). */
import { allCapabilities } from '@/lib/integrations/git-provider'
import {
  PLATFORM_UNSUPPORTED_STAGE,
  REVIEW_VERIFIER_REQUIREMENTS,
  SCAN_LAYER_REQUIREMENTS,
  markUnsupportedLayers,
  unsupportedScanLayers,
} from '@/ee/security/security-scan/platform-support'

describe('unsupportedScanLayers', () => {
  it('a platform with every capability runs every layer', () => {
    expect([...unsupportedScanLayers(allCapabilities())]).toEqual([])
  })
  it('no clone: the sandbox layers are unsupported', () => {
    const caps = { ...allCapabilities(), repoClone: false }
    expect([...unsupportedScanLayers(caps)].sort()).toEqual([
      'external',
      'hunt',
      'supplyChain',
    ])
  })
  it('no per-file list: the agent-behavior layer is unsupported', () => {
    const caps = { ...allCapabilities(), prFileList: false }
    expect([...unsupportedScanLayers(caps)]).toEqual(['rewardHack'])
  })
  it('secrets and the AI review need nothing beyond the core', () => {
    expect(SCAN_LAYER_REQUIREMENTS.secrets).toBeUndefined()
    expect(SCAN_LAYER_REQUIREMENTS.judge).toBeUndefined()
    expect(REVIEW_VERIFIER_REQUIREMENTS).toEqual(['repoClone'])
  })
})

describe('markUnsupportedLayers', () => {
  it('records a present unsupported layer as NOT_CONFIGURED and leaves the rest', () => {
    const stages = { secrets: 'RAN', hunt: 'PENDING', judge: 'RAN' } as const
    const out = markUnsupportedLayers(stages, new Set(['hunt', 'external']))
    expect(PLATFORM_UNSUPPORTED_STAGE).toBe('NOT_CONFIGURED')
    expect(out).toEqual({
      secrets: 'RAN',
      hunt: 'NOT_CONFIGURED',
      judge: 'RAN',
    })
    // An absent layer (not offered) stays absent; the input is not mutated.
    expect('external' in out).toBe(false)
    expect(stages.hunt).toBe('PENDING')
  })
})
