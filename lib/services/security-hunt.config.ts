/**
 * LUM-739 — constants, the kill switch and the step I/O types of the L3
 * hunt. Deliberately import-light (types only): consumed by the
 * `'use workflow'` orchestrator (`lib/workflows/security-hunt.ts`), whose
 * bundle the Workflow SDK compiles into a restricted sandbox, and by stage A
 * for `isHuntEnabled`. Anything that needs GitHub, the AI SDK, zod or the
 * repositories goes in `security-hunt.service.ts`.
 */
import type { Subgraph } from '@/lib/security-scan/graph/types'
import type {
  RejectedCandidate,
  VerifiedCandidate,
  MechanicalVerifyResult,
} from '@/lib/security-scan/hunt/mechanical-verify'

export interface HuntJob {
  scanId: string
  pullRequestId: string
  taskId: string | null
  workspaceId: string
  /** `owner/repo` */
  repo: string
  prNumber: number
  headSha: string
  /**
   * LUM-758 — `evaluateHuntTrigger` 的触发原因，stage A 算完直接传下来。
   * 规划步的主要输入，也是规划失败时确定性兜底的唯一依据。
   */
  reasons: string[]
}

/**
 * The six checklist categories, in run order. Duplicated from
 * `lib/security-scan/hunt/candidate.ts` (which imports zod + node:crypto) so
 * the workflow bundle stays import-light; a test asserts the two agree.
 */
export const HUNT_CATEGORIES = [
  'idor',
  'injection',
  'ssrf',
  'prompt_injection',
  'race',
  'logic',
] as const
export type HuntCategory = (typeof HUNT_CATEGORIES)[number]

/**
 * LUM-758 §11.2 —— 规划步的产出单位。`objective` 是**开放文本**（这个 PR
 * 具体要查什么），`category` 是**封闭的 6 类之一**，唯一作用是给产出定型：
 * mechanicalVerify 要它校验、ruleId 要它、falsifier 的 prompt 要它，最关键的是
 * `huntFingerprint(category, sinkSymbol, entrySymbol)` 要它 —— fingerprint 不
 * 哈希任务标识，所以 inheritDispositions（人工"忽略"跨扫描继承）不受影响。
 * 计划开放、finding 分类封闭，是这个设计成立的支点。
 */
export interface HuntTask {
  /** 't1' —— 一次扫描内稳定；原样进 audit，供事后人工读规划质量。 */
  id: string
  objective: string
  category: HuntCategory
  startingPoints: string[]
}

/** §11.5 —— 3 个才像个图；3 × HUNT_TASK_TOKEN_MAX = 60k = 验收目标均值。 */
export const HUNT_MAX_PLANNED_TASKS = 3
export const HUNT_TASK_TOKEN_MAX = 20_000
export const HUNT_TASK_TIME_MS = 60_000

/**
 * Spec §6 L3 "Hunt" budget per scan. LUM-758 把 LUM-762 的 240k/480s 调回
 * 120k/240s：762 的放大在 prod 被证伪（166k–236k 全部 PARTIAL、0 finding），
 * 真正的成本源是「无条件跑 6 类」而不是预算太小。类别数降到 ≤2 之后，
 * 2 类 × 30k + 2 次补跑正好落在 120k 内。
 */
export const HUNT_TOKEN_BUDGET = 120_000
export const HUNT_TIME_BUDGET_MS = 240_000

/** LUM-758 §4.3 — 规划步自身的预算。它是路由决策，不是分析。 */
export const PLAN_HUNT_TOKEN_BUDGET = 5_000

/**
 * 规划步的墙钟上限。远小于 HUNT_TASK_TIME_MS：一次无工具的 FAST 调用
 * 拖到 20s 就说明网关有问题，此时确定性兜底比继续等更划算。
 */
export const PLAN_HUNT_TIMEOUT_MS = 20_000

/** Tool-calling rounds one category batch may take. */
export const HUNT_MAX_STEPS_PER_CATEGORY = 12
/**
 * LUM-762 — retries INSIDE one model call. The AI SDK's default (2) spends
 * the category's window sitting in exponential backoff — the production
 * signature was `Delay was aborted`, an abort that landed mid-backoff. One
 * retry absorbs a single blip; anything worse should fail fast and be picked
 * up by the workflow's own retry pass, which gets a fresh window.
 */
export const HUNT_CLIENT_MAX_RETRIES = 1
/** Falsifier calls per scan (one VERIFIER call each); the rest → partial. */
export const HUNT_MAX_FALSIFIED = 20
export const HUNT_SNIPPET_RADIUS = 25
export const HUNT_AUDIT_MAX_REJECTED = 50

export type HuntBatchStop = 'done' | 'steps' | 'budget' | 'timeout' | 'error'
/**
 * LUM-762 — `'skipped'` is audit-only: the category never ran because the
 * scan's budget was gone before its turn. Before this it left no row at all,
 * so "which categories did not run" was unanswerable after the fact.
 */
export type HuntCategoryStop = HuntBatchStop | 'skipped'

/**
 * One attempt at one task. A task the retry pass re-ran has TWO rows in
 * `HuntAudit.tasks`, in attempt order — the last one is its outcome.
 * `category` stays here (not just on the `HuntTask` in `planned`) because
 * `parseHuntCoverage` groups by category, not by task identity.
 */
export interface HuntTaskAudit {
  taskId: string
  objective: string
  category: HuntCategory
  candidates: number
  tokens: number
  elapsedMs: number
  stopped: HuntCategoryStop
}

/** Persisted as `PrSecurityScan.huntAudit` (spec §7). */
export interface HuntAudit {
  candidates: number
  rejected: RejectedCandidate[]
  falsifierRejects: number
  falsifierRejected: Array<{ category: string; sink: string; reason: string }>
  tasks: HuntTaskAudit[]
  subgraph: { files: number; symbols: number; edges: number; partial: boolean }
  /** LUM-758 — 规划步选了哪些任务；`[]` = 这个 PR 不值得 hunt。 */
  planned?: HuntTask[]
  plannedReason?: string
  plannedBy?: 'model' | 'fallback'
  error?: string
}

/** LUM-758 §4.2 — 规划步的输入。finding 摘要在 step 内按 scanId 读库。 */
export interface PlanHuntInput {
  job: HuntJob
  subgraph: Subgraph
}

export interface PlanHuntOutput {
  categories: HuntCategory[]
  reason: string
  by: 'model' | 'fallback'
  tokens: number
}

export interface SubgraphResult {
  subgraph: Subgraph
  partial: boolean
}

export interface HuntBatchInput {
  job: HuntJob
  subgraph: Subgraph
  category: HuntCategory
  tokenBudget: number
  timeBudgetMs: number
}

export interface HuntBatchOutput {
  /** Raw submissions — validated by the mechanical gate, not here. */
  candidates: unknown[]
  tokens: number
  elapsedMs: number
  stopped: HuntBatchStop
  error?: string
}

export interface MechanicalVerifyInput {
  subgraph: Subgraph
  candidates: unknown[]
}
export type { MechanicalVerifyResult }

export interface FalsifierInput {
  job: HuntJob
  candidate: VerifiedCandidate
}

export interface FalsifierOutput {
  verdict: 'REJECT' | 'INCONCLUSIVE'
  reason: string
  tokens: number
}

export interface HuntFindingInput extends VerifiedCandidate {
  falsifierReason: string
}

export interface PersistHuntInput {
  job: HuntJob
  findings: HuntFindingInput[]
  audit: HuntAudit
  tokenSpent: number
  partial: boolean
  /** LUM-758 — 写进 `stages.hunt` 的层状态。 */
  stage: 'RAN' | 'PARTIAL' | 'SKIPPED'
}

export type HuntResult =
  | {
      /** LUM-758: SKIPPED = 规划步说这个 PR 不值得 hunt（空子图或空类别）。 */
      outcome: 'RAN' | 'PARTIAL' | 'SKIPPED'
      scanId: string
      findings: number
      tokenSpent: number
    }
  | { outcome: 'FAILED'; scanId: string; reason: string }

/** Kill switch: the hunt is on unless LUMO_SECURITY_HUNT is exactly "off". */
export function isHuntEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.LUMO_SECURITY_HUNT !== 'off'
}
