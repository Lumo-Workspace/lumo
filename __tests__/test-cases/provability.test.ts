/**
 * LUM-808 步骤 2: 可证明性上限。
 *
 * 要挡的两个场景：
 *   1. 一条本该测生产行为的用例在 LOCAL 跑出 PASS，它和一个真 PASS 在库里
 *      长得一模一样。
 *   2. 更危险的：把「我没检查这部分」写成「检查了没问题」。
 *
 * 规则：**只对 PASS 封顶**。自己声明这次验不了的事，不能报 PASS，最多报
 * 「没能确认」（UNPROVEN）。FAIL / BLOCKED 原样返回——「证明了坏」不需要
 * 能力上限，能力不足也照样能把用例跑挂。
 */
import {
  deriveRunCeiling,
  type CeilingRun,
  type CeilingTestCase,
} from '@/lib/test-cases/provability'

const unconstrained: CeilingTestCase = { requiredEnvironment: null }
const prodOnly: CeilingTestCase = { requiredEnvironment: 'PRODUCTION' }

function run(over: Partial<CeilingRun> = {}): CeilingRun {
  return {
    result: 'PASS',
    environment: 'LOCAL',
    unprovenVerification: [],
    ...over,
  }
}

describe('deriveRunCeiling — caps a reported PASS to UNPROVEN', () => {
  it('caps a reported PASS to UNPROVEN when the run is in the wrong environment', () => {
    expect(deriveRunCeiling(run({ environment: 'LOCAL' }), prodOnly)).toEqual({
      effective: 'UNPROVEN',
      reason: 'environment',
      requiredEnvironment: 'PRODUCTION',
      ranIn: 'LOCAL',
    })
  })

  it('caps a reported PASS to UNPROVEN when a verification item went unobserved', () => {
    expect(
      deriveRunCeiling(
        run({
          unprovenVerification: [{ index: 0, text: 'refresh: the page' }],
        }),
        unconstrained
      )
    ).toEqual({
      effective: 'UNPROVEN',
      reason: 'unobserved',
      unobserved: [{ index: 0, text: 'refresh: the page' }],
    })
  })

  it('leaves a PASS alone when nothing limited this run', () => {
    expect(deriveRunCeiling(run(), unconstrained)).toEqual({
      effective: 'PASS',
    })
  })

  it('leaves a PASS alone when the run met the required environment exactly', () => {
    expect(
      deriveRunCeiling(run({ environment: 'PRODUCTION' }), prodOnly)
    ).toEqual({ effective: 'PASS' })
  })
})

describe('deriveRunCeiling — the environment axis is exact, not a hierarchy', () => {
  // 层级看着聪明，实际是错的：一条测本地工具链的用例，在生产跑并不能证明它。
  it.each([
    ['PRODUCTION' as const, { requiredEnvironment: 'PREVIEW' as const }],
    ['PRODUCTION' as const, { requiredEnvironment: 'LOCAL' as const }],
    ['PREVIEW' as const, { requiredEnvironment: 'LOCAL' as const }],
  ])(
    'a PASS in %s does not satisfy a case that requires a different environment',
    (environment, testCase) => {
      expect(deriveRunCeiling(run({ environment }), testCase)).toMatchObject({
        effective: 'UNPROVEN',
        reason: 'environment',
      })
    }
  )
})

describe('deriveRunCeiling — only a PASS is capped', () => {
  it.each(['FAIL', 'BLOCKED'] as const)(
    'returns %s untouched even when the run declared it could prove nothing',
    result => {
      expect(
        deriveRunCeiling(
          run({
            result,
            environment: 'LOCAL',
            unprovenVerification: [{ index: 0, text: 'refresh: the page' }],
          }),
          prodOnly
        )
      ).toEqual({ effective: result })
    }
  )
})

describe('deriveRunCeiling — precedence', () => {
  it('reports the environment axis first when both limits apply', () => {
    // 环境轴更粗、更根本：「这次根本不在能证明它的地方跑」比逐条列未观察项
    // 更有信息量。
    expect(
      deriveRunCeiling(
        run({
          environment: 'LOCAL',
          unprovenVerification: [{ index: 0, text: 'refresh: the page' }],
        }),
        prodOnly
      )
    ).toMatchObject({ effective: 'UNPROVEN', reason: 'environment' })
  })
})

describe('deriveRunCeiling — a case with no verification段 only gets the environment axis', () => {
  it('cannot cap an unconstrained case whose run declared no unobserved items', () => {
    // 已知缺口，写在模块顶注里：verification[] 为空的用例只受环境轴保护。
    expect(
      deriveRunCeiling(run({ unprovenVerification: [] }), unconstrained)
    ).toEqual({ effective: 'PASS' })
  })
})

describe('UNPROVEN is never persisted', () => {
  it('UNPROVEN is never persisted — TestCaseRunResult still has exactly PASS, FAIL, BLOCKED', () => {
    const schema = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    ) as string
    const block = /enum TestCaseRunResult \{([\s\S]*?)\n\}/.exec(schema)
    expect(block).not.toBeNull()
    const values = block![1]!
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(l => /^[A-Z_]+$/.test(l))
    expect(values).toEqual(['PASS', 'FAIL', 'BLOCKED'])
  })

  it('UNPROVEN is never persisted — no test_case_runs column stores the capped verdict', () => {
    const schema = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    ) as string
    const model = /model TestCaseRun \{([\s\S]*?)\n\}/.exec(schema)
    expect(model).not.toBeNull()
    // 只看字段，先剥注释：模型的说明文字里**应该**出现 UNPROVEN（它解释了
    // 为什么这里没有这一列），拿 prose 去命中断言是自己咬自己。
    const fields = model![1]!
      .split('\n')
      .filter(l => !/^\s*\/\//.test(l))
      .join('\n')
    // 封顶结论是推导出来的，存下来第二天就是谎话（同 deriveRunFreshness 不落列）。
    expect(fields).not.toMatch(/\bUNPROVEN\b/)
    expect(fields).not.toMatch(/effectiveResult|cappedResult|ceiling/i)
  })
})
