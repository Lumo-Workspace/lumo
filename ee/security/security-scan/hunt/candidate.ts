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

const SymbolRefSchema = z.object({
  symbol: z.string().min(1).max(400),
  file: z.string().min(1).max(400),
  line: z.number().int().positive(),
})

export const HuntCandidateSchema = z.object({
  category: z.enum(HUNT_CATEGORIES),
  cwe: z.string().regex(/^CWE-\d{1,5}$/),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  sink: SymbolRefSchema,
  entry: SymbolRefSchema,
  call_chain: z
    .array(z.object({ from: z.string().max(400), to: z.string().max(400) }))
    .min(1)
    .max(20),
  precondition: z.string().min(1).max(400),
  claim: z.string().min(1).max(400),
})

export type HuntCandidate = z.infer<typeof HuntCandidateSchema>

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
