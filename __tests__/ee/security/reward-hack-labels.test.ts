/** @jest-environment node */
// LUM-1234 R16 — a REWARD_HACK title is our fixed copy, never model prose.
import {
  REWARD_HACK_KIND_LABELS,
  rewardHackKindLabel,
  rewardHackTitle,
} from '@/ee/security/security-scan/reward-hack-labels'
import { RH_ITEM_KINDS } from '@/ee/security/llm/reward-hack-judge-client'

jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

describe('LUM-1234 reward-hack labels', () => {
  it('has an English label for every kind the judge may return', () => {
    expect(Object.keys(REWARD_HACK_KIND_LABELS).sort()).toEqual(
      [...RH_ITEM_KINDS].sort()
    )
    expect(REWARD_HACK_KIND_LABELS.TEST_TAMPERING).toBe(
      'Weakened or bypassed tests'
    )
  })

  it('an unknown kind reads as the generic label', () => {
    expect(rewardHackKindLabel('NOPE')).toBe('Gamed a check')
    expect(rewardHackKindLabel('constructor')).toBe('Gamed a check')
  })

  it('titles the finding with the kind and, when known, the PR file', () => {
    expect(rewardHackTitle('METRIC_PADDING', 'src/cov.ts')).toBe(
      'Agent behavior: Padded a metric in src/cov.ts'
    )
    expect(rewardHackTitle('OVERCLAIM', '')).toBe(
      'Agent behavior: Claimed more than was done'
    )
  })
})
