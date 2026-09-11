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
  /**
   * LUM-758 Task 10 review — the TS/TSX paths this diff touched, computed by
   * stage A from the SAME `files` the trigger consumes and filtered by
   * `isGraphSourcePath`, so it costs no extra call anywhere.
   *
   * It rides along beside `reasons` because `reasons` alone cannot answer two
   * questions the layer needs:
   *   - short circuit A: `stage-a:high` and `l4:open-crossing` produce no
   *     `diff:` reason, so "did this PR touch any source at all" is the only
   *     thing separating a HIGH-finding PR worth hunting from one that
   *     touched nothing but a README.
   *   - the planner: a reason says a sink fired, never WHERE. Without the
   *     paths a fixture-only `prisma.$queryRawUnsafe` reads exactly like a
   *     production one, and the plan it provokes costs up to 3 ×
   *     HUNT_TASK_TOKEN_MAX.
   */
  touchedSourcePaths: string[]
  /**
   * LUM-758 §5.1 — did stage A actually start the managed scan for this sha?
   * Decides whether `attachOrCreateHuntSandbox` waits for that VM to show up
   * or goes straight to creating its own: the managed scan has four
   * legitimate reasons never to run (BYO SARIF findings already exist, the
   * feature is off, the hourly cap is reached, the start failed), and in
   * those cases polling would only burn 30 s.
   */
  managedScanStarted: boolean
}

/** LUM-758 §5.1 — how long to wait for the managed scan's VM, and how often to look. */
export const HUNT_SANDBOX_ATTACH_WAIT_MS = 30_000
export const HUNT_SANDBOX_ATTACH_POLL_MS = 3_000

/**
 * LUM-758 §5.1 — how long the credential guard waits for the platform's clone
 * to land, and how often it looks. `findRepoSandboxByTag` accepts a `pending`
 * VM on purpose, so the hunt can be holding a VM whose checkout does not
 * exist yet: to that guard a missing `.git/config` means "not yet", never
 * "clean", and it refuses once this runs out.
 */
export const HUNT_CHECKOUT_WAIT_MS = 20_000
export const HUNT_CHECKOUT_POLL_MS = 1_000
/** Characters of one shell command's output that may reach the model. */
export const HUNT_SHELL_OUTPUT_MAX = 8_000

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
 * LUM-758 Task 9 — the floor under what is left of a task's window once the
 * sandbox is in hand. Acquisition is inside the batch's clock (attach poll 30 s
 * + checkout wait 20 s in the worst case), so a batch can legitimately reach
 * the model call with almost nothing left: starting a tool-calling loop on
 * under this much time buys an abort, not an answer. Below it the batch says
 * `timeout` and lets the orchestrator's retry pass have a fresh window — by
 * which time the VM the first batch created is usually there to attach to.
 */
export const HUNT_MIN_BATCH_TIME_MS = 10_000

/**
 * Spec §6 L3 "Hunt" budget per scan. LUM-758 把 LUM-762 的 240k/480s 调回
 * 120k/240s：762 的放大在 prod 被证伪（166k–236k 全部 PARTIAL、0 finding），
 * 真正的成本源是「无条件跑 6 类」而不是预算太小。任务数降到 ≤3 之后，
 * 3 任务 × 20k = 60k（= 验收目标均值）跑完 pass 1，剩下的额度足够整轮补跑；
 * 时间上 3 × 60s = 180s 跑完 pass 1，240s 里还留得下一次补跑。
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
 * `taskId` is the row's identity (`parseHuntCoverage` groups on it, and two
 * tasks may share a category); `category` and `objective` are denormalised
 * onto the row so the audit reads on its own, without joining `planned`.
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
  /**
   * LUM-758 Task 10 — the MECHANICAL GATE's graph, built after the hunt from
   * the files the candidates referenced. `partial` is kept for the shape of
   * the persisted audit and is always false: an on-demand graph cannot be
   * truncated in the sense that mattered, because its size is decided by the
   * candidates, not by a ceiling. It is no longer a source of the layer's
   * `partial` — that it ever was is why PARTIAL used to be routine.
   */
  subgraph: { files: number; symbols: number; edges: number; partial: boolean }
  /** LUM-758 — 规划步选了哪些任务；`[]` = 这个 PR 不值得 hunt。 */
  planned?: HuntTask[]
  plannedReason?: string
  plannedBy?: 'model' | 'fallback'
  /** LUM-758 §9 风险② — 上线后读它判断 30s 轮询窗口够不够。 */
  sandbox?: 'attached' | 'created'
  /**
   * LUM-758 — false means the agent's VM still had a route out while it ran
   * (always the case for an attached VM, whose policy belongs to the managed
   * scan). The command gate is what enforces "no network", so this is not a
   * breach; it is the difference between one control and two, and a run that
   * had only one must be answerable after the fact rather than living in a
   * warn log nobody joins back to the scan.
   */
  egressDenied?: boolean
  error?: string
}

/**
 * LUM-758 §4.2 — 规划步的输入。finding 摘要在 step 内按 scanId 读库。
 *
 * Task 10 去掉了 `subgraph`：子图不再在 hunt 之前建，规划步看到的 diff 视图
 * 就是 `job.reasons`（entry / sink / control 的 rule id 都在里面）。
 */
export interface PlanHuntInput {
  job: HuntJob
}

export interface PlanHuntOutput {
  /** 0–HUNT_MAX_PLANNED_TASKS tasks; `[]` = 这个 PR 不值得 hunt。 */
  tasks: HuntTask[]
  reason: string
  by: 'model' | 'fallback'
  tokens: number
}

/**
 * LUM-758 Task 10 — 机械关的子图**按需**建：hunt 跑完之后，只按候选引用到的
 * 文件建。候选此时还是 `unknown[]`（zod 校验是机械关的活），所以路径收集
 * 必须防御式读。
 */
export interface VerifySubgraphInput {
  job: HuntJob
  candidates: unknown[]
}

export interface HuntBatchInput {
  job: HuntJob
  /**
   * LUM-758 —— 一次批次跑**一个任务**，不是一个类别。同一个 category 在一个
   * 计划里可以出现多次（不同 objective），所以批次的身份是 `task.id`。
   */
  task: HuntTask
  tokenBudget: number
  timeBudgetMs: number
}

export interface HuntBatchOutput {
  /** Raw submissions — validated by the mechanical gate, not here. */
  candidates: unknown[]
  tokens: number
  /**
   * Wall clock for the WHOLE batch, sandbox acquisition included. The
   * orchestrator's `HUNT_TIME_BUDGET_MS` is spent on this number, and the
   * attach poll (30 s) plus the checkout wait (20 s) are real seconds of it —
   * counting only the model call would hide ~50 s of a 240 s budget.
   */
  elapsedMs: number
  stopped: HuntBatchStop
  error?: string
  /** LUM-758 §5.1 — 这一批用的是复用的 VM 还是自建的。 */
  sandbox?: 'attached' | 'created'
  /** Did that VM run with its network egress actually cut? See `HuntSandbox`. */
  egressDenied?: boolean
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
      /** LUM-758: SKIPPED = 规划步说这个 PR 不值得 hunt（空子图或空任务列表）。 */
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
