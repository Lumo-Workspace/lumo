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
 * LUM-758 §4.3 — 一次扫描最多规划几个类别。2 类 × HUNT_CATEGORY_TOKEN_MAX
 * (30k) = 60k，正好是验收目标的平均 tokenSpent；留给补跑的余量来自
 * HUNT_TOKEN_BUDGET (120k) 的另一半。
 */
export const HUNT_MAX_PLANNED_CATEGORIES = 2

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
 * 规划步的墙钟上限。远小于 HUNT_CATEGORY_TIME_MS：一次无工具的 FAST 调用
 * 拖到 20s 就说明网关有问题，此时确定性兜底比继续等更划算。
 */
export const PLAN_HUNT_TIMEOUT_MS = 20_000

/**
 * LUM-762 — the ceiling on ONE batch. A category can never spend more than
 * this, so a gateway that hangs in retry backoff costs its own category and
 * leaves the rest of the scan (and the retry pass) their budget.
 */
export const HUNT_CATEGORY_TIME_MS = 60_000
export const HUNT_CATEGORY_TOKEN_MAX = 30_000
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
 * One attempt at one category. A category the retry pass re-ran has TWO rows
 * in `HuntAudit.categories`, in attempt order — the last one is its outcome.
 */
export interface HuntCategoryAudit {
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
  categories: HuntCategoryAudit[]
  subgraph: { files: number; symbols: number; edges: number; partial: boolean }
  /** LUM-758 — 规划步选了哪些类别；`[]` = 这个 PR 不值得 hunt。 */
  planned?: HuntCategory[]
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
}

export type HuntResult =
  | {
      outcome: 'RAN' | 'PARTIAL'
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
