/**
 * LUM-739 — the Hunt → Verify contract (spec §8). A candidate is what the
 * Hunt model submits; the mechanical gate (`mechanical-verify.ts`) is the
 * only thing that turns one into a `VerifiedCandidate`. Pure.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const HUNT_CATEGORIES = [
  'idor',
  'injection',
  'ssrf',
  'prompt_injection',
  'race',
  'logic',
] as const
export type HuntCategory = (typeof HUNT_CATEGORIES)[number]

/** Guidance only — the model states the CWE it means. */
export const CATEGORY_CWE_HINT: Record<HuntCategory, string> = {
  idor: 'CWE-639',
  injection: 'CWE-74',
  ssrf: 'CWE-918',
  prompt_injection: 'CWE-1427',
  race: 'CWE-362',
  logic: 'CWE-840',
}

/** Longest free-text field (and symbol / file) a candidate may carry. */
export const HUNT_CANDIDATE_TEXT_MAX_CHARS = 400
/** Most call-chain links a candidate may carry. */
export const HUNT_CALL_CHAIN_MAX = 20
/** Most candidates one task may submit. */
export const HUNT_CANDIDATES_PER_TASK_MAX = 10

const SymbolRefSchema = z.object({
  symbol: z.string().min(1).max(HUNT_CANDIDATE_TEXT_MAX_CHARS),
  file: z.string().min(1).max(HUNT_CANDIDATE_TEXT_MAX_CHARS),
  line: z.number().int().positive(),
})

export const HuntCandidateSchema = z.object({
  category: z.enum(HUNT_CATEGORIES),
  cwe: z.string().regex(/^CWE-\d{1,5}$/),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  sink: SymbolRefSchema,
  entry: SymbolRefSchema,
  call_chain: z
    .array(
      z.object({
        from: z.string().max(HUNT_CANDIDATE_TEXT_MAX_CHARS),
        to: z.string().max(HUNT_CANDIDATE_TEXT_MAX_CHARS),
      })
    )
    .min(1)
    .max(HUNT_CALL_CHAIN_MAX),
  precondition: z.string().min(1).max(HUNT_CANDIDATE_TEXT_MAX_CHARS),
  claim: z.string().min(1).max(HUNT_CANDIDATE_TEXT_MAX_CHARS),
})

export type HuntCandidate = z.infer<typeof HuntCandidateSchema>

/** What one task's submissions came to: kept, and dropped with why. */
export interface HuntSubmissionTally {
  /** Candidates the model sent, before anything was cut or dropped. */
  submitted: number
  kept: HuntCandidate[]
  dropped: number
  /**
   * Why, as schema field paths (`cwe`, `sink.line`; array indices removed)
   * plus `limit` for candidates past the per-task cap. Distinct, in first-
   * seen order. Field names only — never model-written text.
   */
  reasons: string[]
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const clip = (v: unknown): unknown =>
  typeof v === 'string' ? v.slice(0, HUNT_CANDIDATE_TEXT_MAX_CHARS) : v

/**
 * LUM-1226 — the length-only limits, applied by cutting instead of rejecting:
 * the prose fields (`precondition`, `claim`, each `call_chain` link) are cut
 * to their limit and `call_chain` to its first links. Symbols and files are
 * identifiers, not prose — a cut one would name something else — so they are
 * left for the schema to judge. Anything not an object passes through as is.
 */
export function normalizeHuntCandidate(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  if ('precondition' in out) out.precondition = clip(out.precondition)
  if ('claim' in out) out.claim = clip(out.claim)
  if (Array.isArray(out.call_chain)) {
    out.call_chain = out.call_chain
      .slice(0, HUNT_CALL_CHAIN_MAX)
      .map(link =>
        isRecord(link)
          ? { ...link, from: clip(link.from), to: clip(link.to) }
          : link
      )
  }
  return out
}

/**
 * LUM-1226 — one task's `submit_candidates` input, candidate by candidate.
 * The tool no longer lets the SDK validate the list as a whole, because one
 * invalid field there voided every candidate in the call. Here the first
 * `HUNT_CANDIDATES_PER_TASK_MAX` are normalized and checked against the
 * unchanged `HuntCandidateSchema`; an invalid one is dropped on its own and
 * the rest are kept.
 */
export function admitHuntSubmission(
  raw: readonly unknown[]
): HuntSubmissionTally {
  const kept: HuntCandidate[] = []
  const reasons = new Set<string>()
  let dropped = 0
  raw.forEach((item, i) => {
    if (i >= HUNT_CANDIDATES_PER_TASK_MAX) {
      dropped += 1
      reasons.add('limit')
      return
    }
    const parsed = HuntCandidateSchema.safeParse(normalizeHuntCandidate(item))
    if (parsed.success) {
      kept.push(parsed.data)
      return
    }
    dropped += 1
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter(seg => typeof seg === 'string').join('.')
      reasons.add(path || 'candidate')
    }
  })
  return { submitted: raw.length, kept, dropped, reasons: [...reasons] }
}

/** Spec §7: sha256(category:sinkSymbol:entrySymbol), 16 hex chars like the other fingerprints. */
export function huntFingerprint(
  category: string,
  sinkSymbol: string,
  entrySymbol: string
): string {
  return createHash('sha256')
    .update(`${category}:${sinkSymbol}:${entrySymbol}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * LUM-1226 — the deploy-log form of a task's submission facts:
 * `submitted=3 kept=2 dropped=1 calls=1 reasons=cwe`. Field names only.
 */
export function formatHuntSubmission(facts: {
  calls: number
  submitted: number
  kept: number
  dropped: number
  reasons?: readonly string[]
}): string {
  const reasons =
    facts.reasons && facts.reasons.length > 0
      ? ` reasons=${facts.reasons.join(',')}`
      : ''
  return `submitted=${facts.submitted} kept=${facts.kept} dropped=${facts.dropped} calls=${facts.calls}${reasons}`
}
