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

import type { HuntSignalSite } from '@/lib/security-scan/hunt/trigger'
import type { PlanFailureFacts } from '@/lib/security-scan/hunt/plan-retry'
import type { PlanRepairKind } from '@/lib/security-scan/hunt/plan-repair'

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
   * LUM-758 follow-up — the located rule hits behind `reasons`: which rule
   * fired, in which file, on which added line.
   *
   * `reasons` is a deduplicated set of rule ids and `touchedSourcePaths` is a
   * flat file list, so between them the layer could say a sink fired and which
   * files were touched, but never which line — and the agent's prompt said, in
   * so many words, "find the call sites yourself". It then spent its allowance
   * re-deriving with `rg` what stage A had already computed and discarded.
   *
   * OPTIONAL, and every reader must tolerate its absence: a run queued by the
   * previous deployment arrives mid-flight without it, and a required field
   * would turn that whole deploy window into FAILED scans — the same hazard
   * `reasons` / `touchedSourcePaths` already carry defaults for.
   */
  signalSites?: HuntSignalSite[]
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
 * LUM-758 §6 — below this many characters the output is NOT compressed. This
 * is the FLOOR of the zone where compressing is arguable, not the crossover:
 * 2 000 characters is ~500 tokens, and one compression call re-reads all of
 * them plus its own system prompt and then pays for its answer, so under this
 * mark the call is a loss in raw tokens AND in price, with nothing to weigh.
 * Above it the trade stops being obvious and becomes the price argument
 * `HuntAudit.compress` exists to settle — see there. The hunt model can also
 * read 2 000 characters of `rg` output perfectly well.
 */
export const HUNT_SHELL_COMPRESS_MIN = 2_000
/**
 * Output ceiling of ONE compression call. 2k tokens can be well over
 * HUNT_SHELL_OUTPUT_MAX characters, which is why the compressed body is
 * truncated again before it is handed on — see `runHuntShell`.
 */
export const HUNT_COMPRESS_TOKEN_BUDGET = 2_000

/**
 * Defang the untrusted-block delimiters inside text that is ABOUT to be put
 * inside one. Both boundaries this crosses are prompt boundaries — the
 * compressor's `<untrusted-command-output>` block and the hunt model's
 * `<untrusted-compressed-output>` block — and repository text legitimately
 * contains such tags (this repo's own `lib/memory/render.ts` writes them), so
 * a `rg untrusted` would otherwise let file content close the block it is
 * quoted inside and continue as if it were the prompt.
 *
 * Pure and dependency-free so the workflow bundle stays import-light; lives
 * here because both sides of the boundary (`lib/llm`, `lib/services`) already
 * import this module and neither may import the other.
 */
export function neutralizeUntrustedTags(text: string): string {
  return text.replace(/<(\/?)(untrusted-[a-z-]*)>/gi, '($1$2)')
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
/**
 * Per-task token ceiling. Two constraints define this number, and
 * `__tests__/security-scan/hunt/budget-arithmetic.test.ts` pins both:
 *
 *   HUNT_MAX_PLANNED_TASKS × this            = the §9 acceptance target mean
 *   HUNT_MAX_PLANNED_TASKS × this × 2        ≤ HUNT_TOKEN_BUDGET (one retry each)
 *
 * It is a SOFT ceiling — `generateText` decides how big its next step is, and
 * the budget can only be judged between steps. It was also, until now, simply
 * not enforced: the old `spent >= budget` check billed the step that crossed
 * the line, and prod (PR 970) delivered 38,262 against this 20,000. The
 * predictive stop in `security-hunt-client.ts` is what makes the number true;
 * the residual is one step's growth, not one whole late step.
 *
 * Raising it is not free and not local: at the observed appetite (~38k for one
 * task) three tasks would bill ~114k, near twice the acceptance target, for a
 * layer that has submitted zero candidates across 25 prod scans. Raise the
 * ceiling only together with HUNT_MAX_PLANNED_TASKS, so the arithmetic above
 * still holds.
 */
export const HUNT_TASK_TOKEN_MAX = 20_000
export const HUNT_TASK_TIME_MS = 60_000
/**
 * Room a task must still have before the forced wrap-up call is worth making.
 * The wrap-up replays the whole transcript, so it costs about what a late
 * search step costs; below this there is not enough left to ask the question
 * and the batch ends as it always did.
 */
export const HUNT_WRAP_UP_MIN_TOKENS = 4_000
/** Wall clock for the wrap-up. The search's own window is already spent. */
export const HUNT_WRAP_UP_TIMEOUT_MS = 30_000

/**
 * Below this, asking is worse than not asking: the replay's first token has
 * not arrived before the abort fires, so the call is billed upstream and
 * returns nothing. The handover is optional; a guaranteed-doomed one is not
 * worth a task's last two seconds.
 */
export const HUNT_WRAP_UP_MIN_MS = 5_000
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

/**
 * LUM-766 — 规划步在真实 prompt 上的实测（16 份：真实验收合同 + 真实 PR 文件表，
 * 经 shipped `planHuntTasks`，2026-09-14，共 47 次开推理成功样本）。下面的预算
 * 常量各自钉在这些读数上，`budget-arithmetic.test.ts` 持有余量系数。改读数要
 * 附新的测量。
 *
 * - 输出需求：FAST_MODEL 是推理模型，这个 schema 上每次规划要先花 200–4 700 个
 *   reasoning token 再写 100–700 个文本 token，且**重尾**（同一份 prompt 两次跑
 *   1 938 / 3 912）。观测到的输出 max ≈ 5 400。
 * - 吞吐：ms ≈ 输出 token × 10.8（≈ 92 tok/s），样本 p10 79 / p0 58 tok/s；
 *   回归残差 p99 ≈ 7 s（网关排队等固定开销）。
 * - objective 篇幅：上限 1000 时 max 961，上限 1200 时 max 1058——模型不贴着
 *   上限写，但会随上限略伸长。
 */
export const PLAN_HUNT_OBSERVED_OUTPUT_MAX = 5_400
/** 取样本 p10 再向下取整——上界要按慢的那头算。 */
export const PLAN_HUNT_OBSERVED_THROUGHPUT_P10_TPS = 75
export const PLAN_HUNT_LATENCY_RESIDUAL_P99_MS = 7_000
export const PLAN_OBJECTIVE_OBSERVED_MAX_CHARS = 1_100

/**
 * LUM-758 §4.3 — 规划步自身的输出预算。它是路由决策，不是分析。
 *
 * LUM-766：它是**尾部上限**，必须盖过实测输出需求并留余量。旧值 5 000 贴着
 * 观测 max，重尾一来就 finish=length → 零输出 → 退确定性兜底，而且 length /
 * schema 失败被判非瞬时、**不重试**。8 000 ≈ 1.5 × 观测 max。
 */
export const PLAN_HUNT_TOKEN_BUDGET = 8_000

/**
 * LUM-766 — 规划任务 `objective` 的字符上限，**必须高于模型的自然篇幅并留
 * ≥ 50% 余量**（用户裁定）。这个数不是「截断长度」：zod 的 .max() 会作为
 * JSON-schema `maxLength` 随请求发给模型，上限低于自然篇幅时，推理模型会在
 * 推理里反复重写去凑，直到把 PLAN_HUNT_TOKEN_BUDGET 整个烧光、一个字不输出
 * （finish=length，16 次里 13 次），剩下的写出来也过不了校验——旧值 400 在真实
 * prompt 上 0/16 成功。超上限 = schema 失败 → 非瞬时 → 不重试 → 整次扫描退兜底。
 * 2 000 ≈ 1.8 × 观测 max：即使篇幅随上限再伸长一成，仍有 ≥ 50% 余量。
 */
export const PLAN_OBJECTIVE_MAX_CHARS = 2_000

/**
 * LUM-776 — the plan-level `reason` has the same trap as `objective`: its
 * zod `.max()` travels to the model as JSON-schema `maxLength`. Production
 * `plannedBy=model` rows (35 scans to 2026-09-14) show reasons up to 462
 * characters against the old cap of 400, and the LUM-776 probe (24 real
 * prompts through the shipped call, cap 1 200) wrote up to 588 — so the old
 * cap sat INSIDE the natural length, the exact condition LUM-766 measured as
 * "rewrite until the budget is gone". Same rule as the objective: ≥ 50 % over
 * the observed max, pinned by `budget-arithmetic.test.ts`.
 */
export const PLAN_REASON_OBSERVED_MAX_CHARS = 588
export const PLAN_REASON_MAX_CHARS = 1_200

/**
 * LUM-776 — `reason` is OPTIONAL in the plan schema. Production PR 994
 * (2026-09-14 15:21Z, the first planner failure after LUM-766's second fix)
 * answered exactly `{"tasks": []}` — no reasoning tokens, eight output
 * tokens, finish=stop — and was booked as `No object generated: response did
 * not match schema` because `reason` was required. A model that has nothing
 * to hunt and nothing to say has given the legal empty plan; this is the
 * reason the audit records for it, so `plannedReason` is never blank.
 */
export const PLAN_EMPTY_REASON =
  'the planner returned no tasks and gave no reason'

/**
 * 规划步的墙钟上限。LUM-766（用户裁定：至少覆盖 p99.9）：几十个样本量不出
 * p99.9，站得住的是**解析上界**——预算封顶了输出，所以
 *   延迟 ≤ PLAN_HUNT_TOKEN_BUDGET ÷ 最慢吞吐 + 固定开销
 *   = 8 000 ÷ 75 tok/s + 7 s ≈ 114 s，取 120 s。
 * 这是 p100（给定预算），自然盖过 p99.9。注意分母用的是样本 p10 吞吐而不是
 * 均值：上界按慢的那头算。
 *
 * 20 s 那版的前提「一次无工具的 FAST 调用拖到 20s 就说明网关有问题」是错的：
 * 健康调用 p50 就在 20 s 上下，20 s 正好切在分布中位数上——每次尝试一半概率
 * 被自己的 abort 打断，两次尝试后仍有约四分之一的扫描退成罐头任务（生产
 * 13 次里 7 次 by=fallback，理由全是 "aborted due to timeout"）。
 *
 * 关掉 reasoning 不是出路：2–10 s 返回，但 16 次里 13 次空计划。
 */
export const PLAN_HUNT_TIMEOUT_MS = 120_000
/**
 * Attempts at the planning call, each with a FRESH `PLAN_HUNT_TIMEOUT_MS`
 * window. `planHunt` never throws, so `planHuntStep`'s platform retry can never
 * fire — without this the first transient gateway blip degrades the scan's plan
 * to the deterministic fallback for good (prod, PR 969). Two, not more: the
 * fallback is a real answer, not an error path, and with a window that covers
 * the whole output budget (LUM-766) a timeout means the gateway did not
 * answer — two windows already equal the hunt's own time budget
 * (HUNT_TIME_BUDGET_MS); a third would put planning above the hunt itself.
 */
export const PLAN_HUNT_MAX_ATTEMPTS = 2

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
  /**
   * LUM-758 follow-up — this task never called `submit_candidates` on its own
   * and was asked for its findings by a forced wrap-up call. The rate of this
   * across scans is the honest measure of whether the agent converges: a layer
   * where every task is wrapped up is a layer whose agent never decides.
   */
  wrappedUp?: boolean
  /**
   * Why a wrap-up that RAN still submitted nothing — the provider's own
   * warnings, above all an `unsupported-setting` for the forced tool choice.
   * Absent when it submitted, and absent when it never ran: an empty answer
   * and a refused request must never read the same, because only one of them
   * is evidence about the agent.
   */
  wrapUpWarnings?: string[]
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
  /**
   * LUM-766 follow-up — how a FAILED planning call actually ended, when it
   * failed. Absent on a plan that worked.
   *
   * The message alone could not answer the only two questions that matter when
   * the planner stops producing plans: was the empty answer a model with
   * nothing to say or one that spent its whole output budget on reasoning
   * (`finishReason`, `reasoningTokens`), and WHICH field did a schema miss
   * miss (`textPrefix` — the raw output that failed validation). Both failures
   * happened in production on the same day and they need opposite responses,
   * and neither was readable from what we stored.
   */
  planFailure?: PlanFailureFacts
  /**
   * LUM-776 — the model's answer only became a plan through
   * `repairPlanText` (`wrapped-array`: a bare task array was wrapped;
   * `missing-tasks`: an object with no `tasks` key was read as an empty
   * plan). Absent when the model wrote the envelope right. `plannedBy` is
   * still `model` — the model did answer — but a repaired `{}` is an empty
   * plan nobody reasoned about, and the read-out must be able to say so.
   */
  planRepair?: PlanRepairKind
  /**
   * Who produced `planned`. Three values, and the third is not decoration:
   *   - `model`   — the planner ran and answered.
   *   - `fallback`— the planner ran and FAILED, so `planFallback` decided.
   *     This is the model-failure rate three deferred launch decisions read.
   *   - `not-attempted` — short circuit A: the diff carried no hunt signal,
   *     so nothing was planned and no planner was called.
   * LUM-758 fifth review: short circuit A used to stamp `fallback`, which
   * booked a planner failure that never happened straight into the read-out
   * the launch decisions depend on. Leaving it absent would have worked too,
   * but absent is also what every pre-LUM-758 audit row has — a third value
   * says "no planning was attempted" without colliding with "written before
   * this field existed".
   */
  plannedBy?: 'model' | 'fallback' | 'not-attempted'
  /**
   * LUM-764 — 规划步是否读到并带上了任务上下文（验收标准 / traps / open
   * crossings / 返工记录）。`false` 的扫描是「这个 PR 没关联任务」，与
   * LUM-758 的行为逐字相同；缺失 = 本字段存在之前写的行。
   */
  taskContext?: boolean
  /**
   * LUM-764 — 地板（`planFallback` 的类别）强制补进计划、模型自己没给的那些
   * 类别。这是地板规则的**代价读数**：非空意味着这次扫描本可能收在 SKIPPED，
   * 是被机械信号按住不许省的。空数组 = 地板生效但模型已经覆盖。
   */
  floorForced?: HuntCategory[]
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
  /**
   * LUM-758 §6.3 — what the shell-output compressor cost and what it bought,
   * over every `run_shell` call of every batch of this scan. This step was
   * scoped as "only if still over budget", so it ships measurable and
   * revertible — but the two numbers are in DIFFERENT UNITS, and the keep-or-
   * revert call is wrong if they are compared directly:
   *
   * - The saving is `inputChars - outputChars` CHARACTERS. At ~4 characters
   *   per token, one call can save at most HUNT_SHELL_OUTPUT_MAX = 8 000
   *   chars ≈ 2 000 tokens of the hunt model's context.
   * - The price is `tokens` TOKENS: the compressor re-reads that same output
   *   as its prompt and may emit up to HUNT_COMPRESS_TOKEN_BUDGET = 2 000
   *   more. So per call the step is roughly BREAK-EVEN in token count, not
   *   the ~4× win the raw difference in the numbers suggests.
   *
   * The real win is therefore a PRICE win — tokens moved off the hunt model
   * and onto FAST — and `tokenSpent` cannot show it, because it adds FAST and
   * GENERATION tokens 1:1. A compression that lowers the dollar cost of a
   * scan can RAISE its "average tokenSpent ≤ 60k" number. Keep or revert this
   * step on price (tokens × each model's rate), never on `tokenSpent`; the
   * budget guard is the only thing `tokenSpent` is for here.
   *
   * - `calls`: compressions that actually replaced the output.
   * - `inputChars` / `outputChars`: characters in and out of those calls,
   *   the compressor's body only — the untrusted wrapper is fixed overhead
   *   the hunt model pays either way.
   * - `tokens`: EVERY token compression spent, duds included, and the same
   *   number is inside the batch's `tokens` (and so inside `tokenSpent`).
   *   Counting it anywhere else would let compression be paid for with money
   *   the "average tokenSpent ≤ 60k" metric cannot see.
   */
  compress?: HuntCompressStats
  error?: string
}

/** One batch's share of `HuntAudit.compress`; summed by the orchestrator. */
export interface HuntCompressStats {
  /** Compressions that replaced the output. */
  calls: number
  /**
   * Compressions that were CHARGED and produced nothing usable — empty, the
   * `(no relevant lines)` sentinel, or a body too small to be a compression of
   * its input. Their tokens are in `tokens` and their characters are NOT in
   * `inputChars` / `outputChars`, because no compression happened.
   *
   * This is the number that was missing when it mattered: prod fed 38,585
   * characters through seven calls and got 133 back — exactly 7 × the sentinel
   * — and the only way to know was to divide. A task whose `noOpCalls` equals
   * its call count searched a repository it could not see, and any conclusion
   * drawn from `candidates: 0` on that scan is worthless.
   */
  noOpCalls: number
  inputChars: number
  outputChars: number
  tokens: number
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
  /**
   * LUM-764 — 这次规划的 prompt 里带了 `<untrusted-task-context>` 吗？
   * 它同时是**地板规则是否生效**的开关（选项 B：没有不可信文字就不加地板，
   * 保持 LUM-758 的成本与行为）。
   *
   * 可选：一个上个部署排队的 workflow 重放旧 step 结果时这两个字段不存在，
   * 读取侧按 `?? false` / `?? []` 退化 —— 与 `HuntJob` 三个字段同一道部署
   * 边界。
   */
  taskContext?: boolean
  /** 地板强制补进计划、模型自己没给的类别（`applyPlanFloor` 的 `forced`）。 */
  floorForced?: HuntCategory[]
  /**
   * LUM-766 follow-up — set only when `by` is `fallback`: how the planning call
   * that failed actually ended. Object spread bypasses TypeScript's excess
   * property check, so without this declaration the field is produced, carried
   * and silently unreadable — the exact shape this layer has lost three fields
   * to already (`wrappedUp`, `wrapUpWarnings`, and the located sites).
   */
  planFailure?: PlanFailureFacts
  /** LUM-776 — see `HuntAudit.planRepair`; set only when `by` is `model`. */
  planRepair?: PlanRepairKind
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
  /**
   * LUM-758 §6.3 — what this batch's `run_shell` compressions cost and saved.
   * Its `tokens` are ALREADY inside `tokens` above; this field only breaks
   * them out so the audit can answer "was compression worth it".
   */
  compress?: HuntCompressStats
  /**
   * LUM-758 follow-up — the search ended on a counter without the agent ever
   * submitting, and a forced wrap-up call asked for what it had. `stopped`
   * still reports the counter: being made to answer is not the same as having
   * finished, and P9 must keep calling such a layer PARTIAL.
   */
  wrappedUp?: boolean
  /**
   * Why a wrap-up that RAN still submitted nothing — the provider's own
   * warnings, above all an `unsupported-setting` for the forced tool choice.
   * Absent when it submitted, and absent when it never ran: an empty answer
   * and a refused request must never read the same, because only one of them
   * is evidence about the agent.
   */
  wrapUpWarnings?: string[]
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
