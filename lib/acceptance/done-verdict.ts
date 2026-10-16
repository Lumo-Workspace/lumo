/**
 * LUM-808 步骤 3: 「这个任务能不能转 DONE」的**唯一住址**。
 *
 * 在这之前，同一条规则散在三处：`task-state.service.ts` 的三个 assert 判定它，
 * `task-status.service.ts` 的 `statusForTask` 渲染它，
 * `task-cli.service.ts` 又手写了一遍送回判断（那行注释自称
 * "mirror the DONE gate" —— 漂移已经发生）。一份规则三处实现的结局是同一次
 * 运行两个结论：网页一套说法，CLI 另一套。
 *
 * ## 为什么不导出裸公式
 *
 * 只导出 `computeDoneVerdict` 与 `renderDoneBlockMessage`，per-plane 的判定留在
 * 模块内。谁都能拿去自己算，就会重新长出上面那三处实现。
 *
 * ## 纯函数
 *
 * 不 import prisma / repository / service。I/O 在
 * `lib/services/done-verdict.service.ts`，它把三个 plane 的查询并发收成快照。
 */

export type CrossingSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export type TestCaseSignal =
  /** 最新 run 是带证据的 IMPLEMENTATION_DEFECT。 */
  | 'PROVEN_DEFECT'
  /** 最新 run 报了 PASS，但被可证明性上限封顶成 UNPROVEN。 */
  | 'UNPROVEN_PASS'
  /** 最新 run 是 CASE_OUTDATED —— 该改用例了，不是该改实现。 */
  | 'CASE_OUTDATED'

/**
 * LUM-819: `UNPROVEN_PASS` 是被哪条边界封顶的。只随 `UNPROVEN_PASS` 出现，
 * 纯读端展示用——闸门从不读它（UNPROVEN 永远只是 advisory）。
 */
export type TestCaseCeilingReason =
  | 'environment'
  | 'unobserved'
  | 'skipped'
  | 'no-evidence'

export interface DoneVerdictSnapshot {
  crossings: {
    /** 未处置（undispositioned）的越界。 */
    open: Array<{ category: string; severity: CrossingSeverity }>
    /** workspace 的 boundaryGateEnabled。HIGH 无视它（LUM-442）。 */
    gateEnabled: boolean
  }
  /** 已按 workspace policy 过滤过的、未处置的**拦截级**发现。 */
  securityFindings: Array<{ ruleId: string; filePath: string }>
  testCases: Array<{
    number: number
    title: string
    signal: TestCaseSignal
    /** 产出这个信号的那一条 run —— 处置就挂在它身上。 */
    runId: string
    /** 这一条 run 已被人裁定过（KNOWN_DEFECT 或 NOT_A_DEFECT 都算）。 */
    dispositioned: boolean
    /** LUM-819: 仅 `UNPROVEN_PASS` 带——封顶原因。 */
    ceilingReason?: TestCaseCeilingReason
  }>
}

export type Blocker =
  | {
      plane: 'BOUNDARY_CROSSING'
      total: number
      byCategory: Array<[string, number]>
    }
  | {
      plane: 'SECURITY_FINDING'
      total: number
      byRule: Array<[string, number]>
    }
  /**
   * LUM-812: 最新一条 run 是**带证据的** IMPLEMENTATION_DEFECT，且还没人裁定过。
   * 不做计数摘要而是逐条列出：一个任务上的用例是个位数，而「是哪条用例坏了」
   * 恰恰是这条消息唯一有用的信息（对比越界/安全那两面动辄几十条、detail 里还
   * 嵌着整段原文，所以那两面只给计数）。
   */
  | {
      plane: 'TEST_CASE_DEFECT'
      items: Array<{ number: number; title: string; runId: string }>
    }

export interface Advisory {
  plane: 'TEST_CASE'
  signal: TestCaseSignal
  number: number
  title: string
  runId: string
  /** LUM-819: 仅 `UNPROVEN_PASS` 带——封顶原因。 */
  ceilingReason?: TestCaseCeilingReason
}

export interface DoneVerdict {
  decision: 'CLEAR' | 'BLOCKED'
  /**
   * 顺序固定：BOUNDARY_CROSSING → SECURITY_FINDING → TEST_CASE_DEFECT。
   * 这是今天三个 assert 的 await 顺序；调用方抛第一个 blocker 就与旧行为
   * 逐字一致。
   */
  blockers: Blocker[]
  /** **永远不改 `decision`。** */
  advisories: Advisory[]
}

/** 按出现次数降序、同次数按名字升序，凑成 "2 A, 1 B" 的紧凑摘要。 */
function tally(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )
}

/**
 * 越界这一面拦不拦。
 *
 * `gateEnabled` 为假时仍拦 HIGH（LUM-442）：opt-out 是给噪音的逃生口，
 * 不是最危险动作的通行证。无论哪种，人的一次处置（FALSE_POSITIVE 或
 * CONFIRMED）都能清掉——始终是「得有人看一眼」，从不是硬墙。
 */
function crossingsBlock(crossings: DoneVerdictSnapshot['crossings']): boolean {
  if (crossings.open.length === 0) return false
  if (crossings.gateEnabled) return true
  return crossings.open.some(c => c.severity === 'HIGH')
}

/**
 * 这个任务现在能不能转 DONE，以及什么在拦它。
 *
 * ## test case 这一面（LUM-812 改写了 LUM-801 的规则）
 *
 * 与 Autonoma 的 merge gate 同调：**只有「证明了坏」才拦**，没测完 / 自己挂了
 * 都放行。落到这里就是——
 *
 * | 信号 | 说的是 | 进哪 |
 * |---|---|---|
 * | `PROVEN_DEFECT` | 我证明了实现是坏的（带证据） | **blockers** |
 * | `UNPROVEN_PASS` | 我没能证明它是好的 | advisories |
 * | `CASE_OUTDATED` | 用例自己过时了 | advisories |
 *
 * LUM-801 原本立的是「用例从不拦 DONE」，理由是进闸会逆向激励「干脆不记 run」。
 * 那个担心是真的，所以这里**不是硬墙**：一次人类处置就清（`dispositioned`），
 * 语义是「已知缺陷，照发」——同越界的 FALSE_POSITIVE / CONFIRMED 都清闸。
 * 代价从「必须先修好」降到「得有人拍一次板」，逆向激励也就没了。
 *
 * 能拦闸的信号**只能来自 agent 自报的归因 + 证据**，永远不能来自 LLM 判定
 * （LUM-740：LLM_JUDGE 的发现不拦 DONE，API schema 拒绝 + reader 忽略）。
 */
export function computeDoneVerdict(s: DoneVerdictSnapshot): DoneVerdict {
  const blockers: Blocker[] = []

  if (crossingsBlock(s.crossings)) {
    blockers.push({
      plane: 'BOUNDARY_CROSSING',
      total: s.crossings.open.length,
      byCategory: tally(s.crossings.open.map(c => c.category)),
    })
  }
  if (s.securityFindings.length > 0) {
    blockers.push({
      plane: 'SECURITY_FINDING',
      total: s.securityFindings.length,
      byRule: tally(s.securityFindings.map(f => f.ruleId)),
    })
  }
  // 排在最后：上面两面的 await 顺序是历史行为，调用方抛第一个 blocker。
  // 新面插在任何一个前面，都会悄悄改掉既有任务看到的那条 409 文案。
  const provenDefects = s.testCases.filter(
    tc => tc.signal === 'PROVEN_DEFECT' && !tc.dispositioned
  )
  if (provenDefects.length > 0) {
    blockers.push({
      plane: 'TEST_CASE_DEFECT',
      items: provenDefects.map(tc => ({
        number: tc.number,
        title: tc.title,
        runId: tc.runId,
      })),
    })
  }

  return {
    decision: blockers.length > 0 ? 'BLOCKED' : 'CLEAR',
    blockers,
    // 已处置的 defect 仍然留在 advisories —— 清掉的是「拦」，不是「有这回事」。
    advisories: s.testCases.map(tc => ({
      plane: 'TEST_CASE' as const,
      signal: tc.signal,
      number: tc.number,
      title: tc.title,
      runId: tc.runId,
      ...(tc.ceilingReason ? { ceilingReason: tc.ceilingReason } : {}),
    })),
  }
}

/**
 * 一个 blocker 的 409 文案。
 *
 * 措辞是从 LUM-422 / LUM-426 / LUM-732 原样搬过来的，**逐字保留**——既有测试
 * 断言的就是这些字符串，收拢不该顺带改文案。
 *
 * 越界与安全两面刻意只给计数摘要，不展开每条 detail：一条 TEST_TAMPERING 的
 * detail 里嵌着整条验收项原文，逐条 join 会变成一墙重复文字（LUM-445/454）。
 */
export function renderDoneBlockMessage(blocker: Blocker): string {
  if (blocker.plane === 'BOUNDARY_CROSSING') {
    const n = blocker.total
    const summary = blocker.byCategory
      .map(([category, count]) => `${count} ${category}`)
      .join(', ')
    return `Cannot move this task to DONE — ${n} undispositioned boundary-crossing${
      n === 1 ? '' : 's'
    } (forbidden action${
      n === 1 ? '' : 's'
    } taken during this task): ${summary}. A human must disposition ${
      n === 1 ? 'it' : 'them'
    } (false positive or confirmed) on the task timeline, or open the gate for this workspace.`
  }

  if (blocker.plane === 'SECURITY_FINDING') {
    const n = blocker.total
    const summary = blocker.byRule
      .map(([rule, c]) => `${rule} ×${c}`)
      .join(', ')
    return `Cannot move this task to DONE — ${n} undispositioned blocking security finding${
      n === 1 ? '' : 's'
    } (${summary}). The user rules on each as false positive or accepted risk — \`lumo finding disposition\` (exit-4 envelope) or the web panel.`
  }

  // LUM-812. 末句刻意点明「不必先修好」：这一面拦的是「没人拍过板」，不是
  // 「缺陷还在」。少了这句，读的人会以为闸门在要求他先去修 bug。
  const n = blocker.items.length
  const cases = blocker.items.map(i => `TC${i.number} "${i.title}"`).join(', ')
  return `Cannot move this task to DONE — ${n} test case${
    n === 1 ? '' : 's'
  } whose latest run proved an implementation defect with evidence: ${cases}. A human must disposition ${
    n === 1 ? 'it' : 'each'
  } on the task timeline (known defect — ship anyway, or not a defect). Fixing the defect first is not required to clear this.`
}
