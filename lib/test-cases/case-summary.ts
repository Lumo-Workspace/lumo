/**
 * LUM-1011: 任务的测试用例在 Record 页上的汇总——每条用例最新一次的结论，
 * 以及哪些 run 正拦着 DONE。
 *
 * **这个模块必须保持纯净——不得 import prisma、repository 或 service**（客户端
 * 组件直接用；理由同 `./provability.ts`）。
 *
 * 拦截规则与服务端 DONE 闸（`done-verdict.service.ts` 的 collectTestCasePlane，
 * LUM-812）同一条：**每条用例最新一条** run 归因为 IMPLEMENTATION_DEFECT 且还
 * 没人裁定。这里只是把它摆到页面上，闸门本身仍在服务端——两边对不上时以 409
 * 为准，这里绝不放宽。
 */
import { deriveStoredRunCeiling, type CeilingEnvironment } from './provability'

export type CaseVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNPROVEN' | 'NEVER_RUN'

/** 汇总需要的 run 列——结构化最小类型。 */
export interface SummaryRun {
  id: string
  result: 'PASS' | 'FAIL' | 'BLOCKED'
  environment: CeilingEnvironment
  failureAttribution: string | null
  unprovenVerification: unknown
  evidence: unknown
  /** LUM-1211: SKIP 步会把 PASS 封顶成 UNPROVEN(skipped)。 */
  stepResults: unknown
  disposition: unknown | null
}

export interface SummaryCase {
  number: number
  title: string
  requiredEnvironment: CeilingEnvironment | null
  /** 新到旧。 */
  runs: SummaryRun[]
}

/** 最新一条 run 的**封顶后**结论（LUM-808）：报了 PASS 却验不了的读作 UNPROVEN。 */
export function deriveLatestVerdict(
  latest: SummaryRun | null,
  requiredEnvironment: CeilingEnvironment | null
): CaseVerdict {
  if (!latest) return 'NEVER_RUN'
  const ceiling = deriveStoredRunCeiling(latest, requiredEnvironment)
  return ceiling.effective
}

export interface BlockingDefect {
  caseNumber: number
  title: string
  runId: string
}

export interface TestCasesSummary {
  total: number
  passing: number
  failing: number
  notRun: number
  /** BLOCKED / UNPROVEN：跑过，但没证明通过也不是失败。 */
  inconclusive: number
  /** 正拦着 DONE 的 run（每条用例至多一条：它最新的那条）。 */
  blocking: BlockingDefect[]
}

export function summarizeTestCases(cases: SummaryCase[]): TestCasesSummary {
  const summary: TestCasesSummary = {
    total: cases.length,
    passing: 0,
    failing: 0,
    notRun: 0,
    inconclusive: 0,
    blocking: [],
  }
  for (const c of cases) {
    const latest = c.runs[0] ?? null
    const verdict = deriveLatestVerdict(latest, c.requiredEnvironment)
    if (verdict === 'PASS') summary.passing++
    else if (verdict === 'FAIL') summary.failing++
    else if (verdict === 'NEVER_RUN') summary.notRun++
    else summary.inconclusive++
    if (
      latest &&
      latest.failureAttribution === 'IMPLEMENTATION_DEFECT' &&
      latest.disposition == null
    ) {
      summary.blocking.push({
        caseNumber: c.number,
        title: c.title,
        runId: latest.id,
      })
    }
  }
  return summary
}
