/** @jest-environment node */
// LUM-1234 — sizing a reward-hack model call before and after it runs.
import {
  RH_MAX_INPUT_TOKENS,
  estimateRhCallUsd,
  estimateRhTokens,
  rhTokensCostUsd,
  settledRhCallUsd,
} from '@/ee/security/security-scan/reward-hack-cost'

describe('LUM-1234 reward-hack call cost', () => {
  it('estimates ASCII at 3 characters a token and every other character as a token', () => {
    expect(estimateRhTokens('abcdef')).toBe(2)
    expect(estimateRhTokens('abcd')).toBe(2)
    expect(estimateRhTokens('测试测试')).toBe(4)
    expect(estimateRhTokens('ab测')).toBe(2)
    expect(RH_MAX_INPUT_TOKENS).toBe(180_000)
  })

  it('prices tokens at the model list price', () => {
    expect(rhTokensCostUsd(1_000_000, 0)).toBe(3)
    expect(rhTokensCostUsd(0, 1_000_000)).toBe(15)
  })

  it('an estimate covers the whole input plus the most the call may write', () => {
    expect(estimateRhCallUsd('x'.repeat(3_000_000), 1_000_000)).toBe(3 + 15)
  })

  it('settles to the reported cost, else usage at list price, else keeps the estimate', () => {
    expect(settledRhCallUsd({ costUsd: 0.2 }, 1)).toBe(0.2)
    expect(
      settledRhCallUsd(
        { costUsd: null, inputTokens: 1_000_000, outputTokens: 0 },
        1
      )
    ).toBe(3)
    expect(settledRhCallUsd({ costUsd: null }, 0.75)).toBe(0.75)
    expect(
      settledRhCallUsd({ costUsd: null, inputTokens: 0, outputTokens: 0 }, 0.75)
    ).toBe(0.75)
    expect(settledRhCallUsd({ costUsd: -1 }, 0.75)).toBe(0)
  })

  it('books the larger of the reported cost and token usage at list price (a reported 0 with billed tokens is not free)', () => {
    expect(
      settledRhCallUsd(
        { costUsd: 0, inputTokens: 1_000_000, outputTokens: 0 },
        1
      )
    ).toBe(3)
    expect(
      settledRhCallUsd(
        { costUsd: 0.5, inputTokens: 0, outputTokens: 1_000_000 },
        1
      )
    ).toBe(15)
    // A reported cost above the list-price usage stands.
    expect(
      settledRhCallUsd(
        { costUsd: 4, inputTokens: 1_000_000, outputTokens: 0 },
        1
      )
    ).toBe(4)
    // Reported 0 and no usage: nothing says it was billed.
    expect(settledRhCallUsd({ costUsd: 0 }, 0.75)).toBe(0)
  })
})
