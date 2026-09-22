/**
 * LUM-808 步骤 3: 「这个任务能不能转 DONE」只有一个住址。
 *
 * 这组测试有两个职责，第二个比第一个重要：
 *   1. 三个拦截面的判定与今天逐字一致（收拢没有行为漂移）
 *   2. **三个看起来一样的规则其实是三个问题**，口径不同是设计，不是 bug。
 *      谁将来「顺手」把它们合并，这里先红。
 */
import {
  computeDoneVerdict,
  renderDoneBlockMessage,
  hasUnresolvedSendBack,
  type DoneVerdictSnapshot,
} from '@/lib/acceptance/done-verdict'
import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'

function snapshot(
  over: Partial<DoneVerdictSnapshot> = {}
): DoneVerdictSnapshot {
  return {
    sendBacks: [],
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

describe('computeDoneVerdict — send-back plane', () => {
  it('blocks while a criterion stands failed', () => {
    const v = computeDoneVerdict(
      snapshot({ sendBacks: [{ criterionId: 'c1', statement: 'it works' }] })
    )
    expect(v.decision).toBe('BLOCKED')
    expect(v.blockers[0]).toMatchObject({ plane: 'SEND_BACK' })
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
  it('lists send-back, then crossing, then security', () => {
    const v = computeDoneVerdict(
      snapshot({
        sendBacks: [{ criterionId: 'c1', statement: 's' }],
        crossings: {
          open: [{ category: 'PROJECT_RULE_VIOLATION', severity: 'HIGH' }],
          gateEnabled: true,
        },
        securityFindings: [{ ruleId: 'rule-a', filePath: 'lib/x.ts' }],
      })
    )
    expect(v.blockers.map(b => b.plane)).toEqual([
      'SEND_BACK',
      'BOUNDARY_CROSSING',
      'SECURITY_FINDING',
    ])
  })
})

describe('advisories never change the decision', () => {
  it.each(['PROVEN_DEFECT', 'UNPROVEN_PASS', 'CASE_OUTDATED'] as const)(
    'advisories never change the decision — a %s test-case signal leaves a clean task CLEAR',
    signal => {
      const v = computeDoneVerdict(
        snapshot({ testCases: [{ number: 3, title: 'Footer', signal }] })
      )
      expect(v.decision).toBe('CLEAR')
      expect(v.blockers).toEqual([])
      expect(v.advisories).toEqual([
        { plane: 'TEST_CASE', signal, number: 3, title: 'Footer' },
      ])
    }
  )

  it('advisories never change the decision — they do not rescue a blocked task either', () => {
    const v = computeDoneVerdict(
      snapshot({
        sendBacks: [{ criterionId: 'c1', statement: 's' }],
        testCases: [{ number: 1, title: 'x', signal: 'UNPROVEN_PASS' }],
      })
    )
    expect(v.decision).toBe('BLOCKED')
    expect(v.advisories).toHaveLength(1)
  })
})

describe('renderDoneBlockMessage — the 409 wording is preserved verbatim', () => {
  it('names the failed criteria for a send-back', () => {
    const msg = renderDoneBlockMessage({
      plane: 'SEND_BACK',
      items: [{ criterionId: 'c1', statement: 'the endpoint returns 409' }],
    })
    expect(msg).toContain('Cannot move this task to DONE')
    expect(msg).toContain('1 unresolved send-back')
    expect(msg).toContain('the endpoint returns 409')
  })

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
 * 这三个问题看着像同一个，答案两两不同。合并任何两个都会坏事——
 * 把裁决口径换成渲染口径，在 web 上点一条 PASS 就会把整个任务推成 DONE。
 */
describe('the DONE gate, the display rule and the auto-advance rule disagree by design', () => {
  it('an unadjudicated HUMAN criterion is a tacit pass at the gate and hidden from the todo list', () => {
    // 闸：未裁定项根本不进 sendBacks，所以放行。
    expect(computeDoneVerdict(snapshot()).decision).toBe('CLEAR')
    // 渲染：未裁定的 HUMAN 项不呈现为待办。
    expect(isUnmetForDisplay({ verifierType: 'HUMAN' }, undefined)).toBe(false)
  })

  it('a never-run MACHINE criterion shows up as a todo but does NOT block the gate', () => {
    // 这一格正是两条规则**不同**的地方：渲染要提醒，闸不拦。
    expect(isUnmetForDisplay({ verifierType: 'MACHINE' }, undefined)).toBe(true)
    expect(computeDoneVerdict(snapshot()).decision).toBe('CLEAR')
  })

  it('only an explicit FAIL reaches the gate', () => {
    expect(hasUnresolvedSendBack([])).toBe(false)
    expect(hasUnresolvedSendBack([{ criterionId: 'c', statement: 's' }])).toBe(
      true
    )
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
