/**
 * LUM-808 步骤 3: 「这个任务能不能转 DONE」只有一个住址。
 *
 * 各拦截面的判定与收拢前逐字一致（收拢没有行为漂移）。
 * LUM-942: 验收标准的 SEND_BACK 面已随标准功能一并移除。
 */
import {
  computeDoneVerdict,
  renderDoneBlockMessage,
  type DoneVerdictSnapshot,
} from '@/lib/acceptance/done-verdict'

function snapshot(
  over: Partial<DoneVerdictSnapshot> = {}
): DoneVerdictSnapshot {
  return {
    crossings: { open: [], gateEnabled: true },
    securityFindings: [],
    testCases: [],
    ...over,
  }
}

describe('computeDoneVerdict — a clean task', () => {
  it('is CLEAR with no blockers and no advisories', () => {
    expect(computeDoneVerdict(snapshot())).toEqual({
      decision: 'CLEAR',
      blockers: [],
      advisories: [],
    })
  })
})

describe('computeDoneVerdict — boundary-crossing plane', () => {
  it('blocks an open crossing while the workspace gate is on', () => {
    const v = computeDoneVerdict(
      snapshot({
        crossings: {
          open: [{ category: 'PROJECT_RULE_VIOLATION', severity: 'LOW' }],
          gateEnabled: true,
        },
      })
    )
    expect(v.decision).toBe('BLOCKED')
    expect(v.blockers[0]).toMatchObject({ plane: 'BOUNDARY_CROSSING' })
  })

  it('lets a non-HIGH crossing through when the workspace opted the gate out', () => {
    const v = computeDoneVerdict(
      snapshot({
        crossings: {
          open: [{ category: 'PROJECT_RULE_VIOLATION', severity: 'MEDIUM' }],
          gateEnabled: false,
        },
      })
    )
    expect(v.decision).toBe('CLEAR')
  })

  it('still blocks a HIGH crossing with the gate opted out — the opt-out is for noise, not for the most dangerous actions', () => {
    const v = computeDoneVerdict(
      snapshot({
        crossings: {
          open: [{ category: 'SECRET_LEAK', severity: 'HIGH' }],
          gateEnabled: false,
        },
      })
    )
    expect(v.decision).toBe('BLOCKED')
    expect(v.blockers[0]).toMatchObject({ plane: 'BOUNDARY_CROSSING' })
  })
})

describe('computeDoneVerdict — security-finding plane', () => {
  it('blocks an undispositioned blocking finding', () => {
    const v = computeDoneVerdict(
      snapshot({
        securityFindings: [{ ruleId: 'rule-a', filePath: 'lib/x.ts' }],
      })
    )
    expect(v.decision).toBe('BLOCKED')
    expect(v.blockers[0]).toMatchObject({ plane: 'SECURITY_FINDING' })
  })
})

describe('computeDoneVerdict — blocker order matches the order the gate has always checked in', () => {
  it('lists crossing, then security', () => {
    const v = computeDoneVerdict(
      snapshot({
        crossings: {
          open: [{ category: 'PROJECT_RULE_VIOLATION', severity: 'HIGH' }],
          gateEnabled: true,
        },
        securityFindings: [{ ruleId: 'rule-a', filePath: 'lib/x.ts' }],
      })
    )
    expect(v.blockers.map(b => b.plane)).toEqual([
      'BOUNDARY_CROSSING',
      'SECURITY_FINDING',
    ])
  })
})

/**
 * LUM-812: 这一组原本断言「PROVEN_DEFECT 也只是 advisory」。那条规则被推翻了
 * ——按 Autonoma 的口径「只有证明了坏才拦」，带证据的 defect 正是证明了坏。
 * 其余信号一个字没动：它们说的都是「我没能证明」，不是「我证明了坏」。
 */
describe('advisories never change the decision', () => {
  it.each(['UNPROVEN_PASS', 'CASE_OUTDATED'] as const)(
    'advisories never change the decision — a %s test-case signal leaves a clean task CLEAR',
    signal => {
      const v = computeDoneVerdict(
        snapshot({
          testCases: [
            {
              number: 3,
              title: 'Footer',
              signal,
              runId: 'r1',
              dispositioned: false,
            },
          ],
        })
      )
      expect(v.decision).toBe('CLEAR')
      expect(v.blockers).toEqual([])
      expect(v.advisories).toEqual([
        { plane: 'TEST_CASE', signal, number: 3, title: 'Footer', runId: 'r1' },
      ])
    }
  )

  it('a proven defect blocks while every other test-case signal stays advisory', () => {
    const others = ['UNPROVEN_PASS', 'CASE_OUTDATED'] as const
    const v = computeDoneVerdict(
      snapshot({
        testCases: [
          ...others.map((signal, i) => ({
            number: i + 1,
            title: `case ${i + 1}`,
            signal,
            runId: `r${i + 1}`,
            dispositioned: false,
          })),
          {
            number: 9,
            title: 'Footer keeps the nav row',
            signal: 'PROVEN_DEFECT' as const,
            runId: 'r9',
            dispositioned: false,
          },
        ],
      })
    )

    expect(v.decision).toBe('BLOCKED')
    expect(v.blockers).toEqual([
      {
        plane: 'TEST_CASE_DEFECT',
        items: [{ number: 9, title: 'Footer keeps the nav row', runId: 'r9' }],
      },
    ])
    // 其余两类照旧只进 advisories，一条都没被升级。
    expect(v.advisories.map(a => a.signal).sort()).toEqual([
      'CASE_OUTDATED',
      'PROVEN_DEFECT',
      'UNPROVEN_PASS',
    ])
  })

  it('a dispositioned defect stops blocking the gate but stays on the record as an advisory', () => {
    const v = computeDoneVerdict(
      snapshot({
        testCases: [
          {
            number: 9,
            title: 'Footer keeps the nav row',
            signal: 'PROVEN_DEFECT',
            runId: 'r9',
            dispositioned: true,
          },
        ],
      })
    )
    expect(v.decision).toBe('CLEAR')
    expect(v.blockers).toEqual([])
    expect(v.advisories).toHaveLength(1)
  })

  it('the test-case plane is checked last so every existing first-blocker stays what it was', () => {
    const v = computeDoneVerdict(
      snapshot({
        crossings: {
          open: [{ category: 'PROJECT_RULE_VIOLATION', severity: 'HIGH' }],
          gateEnabled: true,
        },
        testCases: [
          {
            number: 1,
            title: 'x',
            signal: 'PROVEN_DEFECT',
            runId: 'r1',
            dispositioned: false,
          },
        ],
      })
    )
    expect(v.blockers.map(b => b.plane)).toEqual([
      'BOUNDARY_CROSSING',
      'TEST_CASE_DEFECT',
    ])
  })

  it('advisories never change the decision — they do not rescue a blocked task either', () => {
    const v = computeDoneVerdict(
      snapshot({
        securityFindings: [{ ruleId: 'rule-a', filePath: 'lib/x.ts' }],
        testCases: [
          {
            number: 1,
            title: 'x',
            signal: 'UNPROVEN_PASS',
            runId: 'r1',
            dispositioned: false,
          },
        ],
      })
    )
    expect(v.decision).toBe('BLOCKED')
    expect(v.advisories).toHaveLength(1)
  })
})

describe('renderDoneBlockMessage — the 409 wording is preserved verbatim', () => {
  it('summarises crossings by category without dumping each detail', () => {
    const msg = renderDoneBlockMessage({
      plane: 'BOUNDARY_CROSSING',
      total: 3,
      byCategory: [
        ['PROJECT_RULE_VIOLATION', 2],
        ['TEST_TAMPERING', 1],
      ],
    })
    expect(msg).toContain('3 undispositioned boundary-crossings')
    expect(msg).toContain('2 PROJECT_RULE_VIOLATION, 1 TEST_TAMPERING')
  })

  it('summarises security findings by rule', () => {
    const msg = renderDoneBlockMessage({
      plane: 'SECURITY_FINDING',
      total: 2,
      byRule: [['rule-a', 2]],
    })
    expect(msg).toContain('2 undispositioned blocking security findings')
    expect(msg).toContain('rule-a ×2')
  })
})

/**
 * 收口的另一半：调用方不许自带公式。这里读源码断言「坏状态不存在」，
 * 而不是断言「某个具名修复存在」——后者会在有人换实现时失效，却挡不住
 * 保护被绕过（c-CRAB 边界）。
 */
describe('the formula has exactly one address', () => {
  const read = (rel: string) =>
    require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), rel),
      'utf8'
    ) as string

  it.each([
    'lib/services/task-state.service.ts',
    'lib/services/task-cli.service.ts',
  ])('%s does not re-derive the send-back rule itself', rel => {
    const src = read(rel)
    // 今天 task-cli.service 手写的就是这一行（注释里自称 "mirror the DONE gate"）。
    expect(src).not.toMatch(/verdict\s*===\s*['"]FAIL['"]/)
  })
})

describe('computeDoneVerdict — DONE_REQUIREMENT plane (LUM-1334)', () => {
  const requirements = {
    switches: { testCase: true, review: true },
    missing: [
      { requirement: 'TEST_CASE' as const, prNumber: 12 },
      { requirement: 'REVIEW' as const, prNumber: 12 },
      { requirement: 'REVIEW' as const, prNumber: 13 },
    ],
  }

  it('is CLEAR when nothing is missing, or the snapshot has no plane', () => {
    expect(
      computeDoneVerdict(
        snapshot({ requirements: { ...requirements, missing: [] } })
      ).decision
    ).toBe('CLEAR')
    expect(computeDoneVerdict(snapshot()).decision).toBe('CLEAR')
  })

  it('blocks, after every older plane, so the first 409 text is unchanged', () => {
    const v = computeDoneVerdict(
      snapshot({
        crossings: {
          open: [{ category: 'PROJECT_RULE_VIOLATION', severity: 'LOW' }],
          gateEnabled: true,
        },
        requirements,
      })
    )
    expect(v.blockers.map(b => b.plane)).toEqual([
      'BOUNDARY_CROSSING',
      'DONE_REQUIREMENT',
    ])
  })

  it('names each PR and what clears it', () => {
    const v = computeDoneVerdict(snapshot({ requirements }))
    const msg = renderDoneBlockMessage(v.blockers[0]!)
    expect(msg).toMatch(/^Cannot move this task to DONE/)
    expect(msg).toContain(
      'requires a passing test-case run and a review on each pull request'
    )
    expect(msg).toContain('PR #12: passing test case, review; PR #13: review')
    expect(msg).toContain('lumo task testcase run')
    expect(msg).toContain('lumo review import')
    expect(msg).toContain('turn these requirements off in Settings')
  })

  it('only mentions the remedy for what is missing', () => {
    const v = computeDoneVerdict(
      snapshot({
        requirements: {
          switches: { testCase: false, review: true },
          missing: [{ requirement: 'REVIEW', prNumber: 7 }],
        },
      })
    )
    const msg = renderDoneBlockMessage(v.blockers[0]!)
    expect(msg).toContain('requires a review on each pull request')
    expect(msg).not.toContain('testcase run')
  })
})
