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
 * Spec §6 L3 "Hunt" budget per scan. Raised from 150k/200s by LUM-762: the
 * six categories are six independent step invocations, so this was never a
 * platform limit — it was our own constant, and at 200s one wedged category
 * spent the whole scan's window and the layer ended PARTIAL every time.
 * Sized as 8 × the per-category ceiling: six categories plus two retries.
 * Provisional — the first real `huntAudit` read-out (per-category elapsedMs,
 * now surfaced by `lumo task status`) is what should correct these numbers.
 */
export const HUNT_TOKEN_BUDGET = 240_000
export const HUNT_TIME_BUDGET_MS = 480_000
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
  error?: string
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
