/**
 * LUM-819 (C): 零证据的 PASS → 封顶 UNPROVEN(no-evidence)。
 *
 * 裁定（用户，2026-09-23）：
 *   - 按「有没有证据」判，不看谁跑的——人跑了什么都没留，照样证不了。
 *   - 读端推导、不落列，所以历史上的零证据 PASS 也按同一口径显示，不按
 *     createdAt 切线。
 *
 * 优先级：环境 > 未观察 > 无证据。FAIL / BLOCKED 从不封顶。
 */
import {
  countEvidence,
  deriveRunCeiling,
  type CeilingRun,
} from '@/lib/test-cases/provability'
import { formatRunOutcome } from '../cli/src/lib/test-case-verdict'
import { formatTestCaseVerdictAction } from '../cli/src/commands/task-status'

function run(over: Partial<CeilingRun> = {}): CeilingRun {
  return {
    result: 'PASS',
    environment: 'LOCAL',
    unprovenVerification: [],
    evidenceCount: 0,
    ...over,
  }
}

const anyEnv = { requiredEnvironment: null }

describe('LUM-819 no-evidence ceiling', () => {
  it('a PASS with no evidence is capped to UNPROVEN', () => {
    // 1. 核心：零证据的 PASS 被封顶，附一条证据就是真 PASS。
    expect(deriveRunCeiling(run(), anyEnv)).toEqual({
      effective: 'UNPROVEN',
      reason: 'no-evidence',
    })
    expect(deriveRunCeiling(run({ evidenceCount: 1 }), anyEnv)).toEqual({
      effective: 'PASS',
    })

    // 2. 只对 PASS 封顶：零证据的 FAIL / BLOCKED 原样返回。
    expect(deriveRunCeiling(run({ result: 'FAIL' }), anyEnv)).toEqual({
      effective: 'FAIL',
    })
    expect(deriveRunCeiling(run({ result: 'BLOCKED' }), anyEnv)).toEqual({
      effective: 'BLOCKED',
    })

    // 3. 优先级：环境 > 未观察 > 无证据。
    expect(
      deriveRunCeiling(
        run({ unprovenVerification: [{ index: 0, text: 'x' }] }),
        { requiredEnvironment: 'PRODUCTION' }
      )
    ).toMatchObject({ effective: 'UNPROVEN', reason: 'environment' })
    expect(
      deriveRunCeiling(
        run({ unprovenVerification: [{ index: 0, text: 'x' }] }),
        anyEnv
      )
    ).toMatchObject({ effective: 'UNPROVEN', reason: 'unobserved' })

    // 4. 历史行：Json 列读出来可能不是数组（旧行 / 脏数据）——按 0 条算，
    //    往少了算才安全。数组照实计数。
    expect(countEvidence(undefined)).toBe(0)
    expect(countEvidence(null)).toBe(0)
    expect(countEvidence({})).toBe(0)
    expect(countEvidence([])).toBe(0)
    expect(countEvidence([{ type: 'link', url: 'https://x.test' }])).toBe(1)

    // 5. run 回显：当场说清是「没有证据」，不用失败词汇。
    const echo = formatRunOutcome({
      handle: 'LUM-1/TC1',
      reported: 'PASS',
      environment: 'LOCAL',
      ceiling: { effective: 'UNPROVEN', reason: 'no-evidence' },
    })
    expect(echo).toBe(
      'Recorded LUM-1/TC1: PASS on LOCAL → UNPROVEN (no evidence attached — nobody else can re-read this PASS)'
    )
    expect(echo).not.toMatch(/fail|✗/i)

    // 6. task status：advisory 行与挂在标准下的用例行都点名原因。
    const advisory = formatTestCaseVerdictAction({
      kind: 'TEST_CASE_VERDICT',
      signal: 'UNPROVEN_PASS',
      number: 2,
      title: 'login works',
      ceilingReason: 'no-evidence',
      advisory: true,
    })
    expect(advisory).toBe(
      '  • [TEST CASE] TC2 login works — reported PASS, capped to UNPROVEN (no evidence attached) (advisory)'
    )
  })

  it('an older server without ceilingReason still renders the advisory line', () => {
    expect(
      formatTestCaseVerdictAction({
        kind: 'TEST_CASE_VERDICT',
        signal: 'UNPROVEN_PASS',
        number: 1,
        title: 't',
        advisory: true,
      })
    ).toBe(
      '  • [TEST CASE] TC1 t — reported PASS, capped to UNPROVEN (advisory)'
    )
  })
})
