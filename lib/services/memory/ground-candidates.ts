import { FAST_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { logger } from '@/lib/logger'

/**
 * LUM-396: grounding gate (quote-or-discard) between candidate extraction and
 * reconciliation, shared by Layer 1 and Layer 2.
 *
 * Source: ProMem (arXiv 2601.04463). deepseek-v4-flash under the aggressive
 * 4-category compression schema occasionally emits candidates with no basis in
 * the source material (hallucinated inference). A novel hallucinated candidate
 * receives essentially no scrutiny downstream — reconcile only compares it
 * against neighbors (a novel candidate has none) — so this gate is the one
 * review it gets. Worse, a hallucinated candidate that reaches reconcile can
 * trigger SUPERSEDE and invalidate a good existing memory, which is why the
 * gate MUST run before neighbor retrieval / reconcile.
 *
 * Unlike ProMem's per-fact re-read loop, this is ONE batched call: the same
 * source material the extract pass saw + all candidates. Each candidate must be
 * backed by a verbatim supporting quote from the source, or be labeled
 * UNSUPPORTED. UNSUPPORTED candidates are discarded (counted, logged).
 *
 * Failure posture (this sits on a fire-and-forget write path):
 * - the whole call failing → fail-open: every candidate passes through;
 * - a malformed verdict element → affects only itself (the candidate it would
 *   have judged stays kept); other verdicts in the batch still apply
 *   (LUM-335 LOOSE-schema discipline: drop garbage, never sink the batch).
 * Only an explicit, well-formed UNSUPPORTED verdict discards a candidate.
 */

const MODEL_ID = FAST_MODEL

/**
 * Loose schema handed to `generateObject` — raw objects, validated per-element
 * afterwards, so one malformed verdict can't throw and nuke the batch.
 */
export const LOOSE_GROUNDING_OUTPUT = z.object({
  verdicts: z.array(z.record(z.string(), z.unknown())).default([]),
})

const groundingVerdictSchema = z.object({
  index: z.number().int().min(0),
  verdict: z.enum(['SUPPORTED', 'UNSUPPORTED']),
  quote: z.string().optional(),
})

export type GroundingVerdict = z.infer<typeof groundingVerdictSchema>

/**
 * Coerce one raw verdict element into a valid verdict (or null).
 *
 * Tolerated drift (same spirit as reconcile-parse's `operation`→`type` alias):
 * - `i` / `candidateIndex` in place of `index`;
 * - lowercase / mixed-case verdict values;
 * - a numeric-string index.
 */
export function coerceGroundingVerdict(raw: unknown): GroundingVerdict | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const el = { ...(raw as Record<string, unknown>) }
  if (!('index' in el)) {
    if ('candidateIndex' in el) el.index = el['candidateIndex']
    else if ('i' in el) el.index = el['i']
  }
  if (typeof el.index === 'string' && /^\d+$/.test(el.index)) {
    el.index = Number(el.index)
  }
  if (typeof el.verdict === 'string') el.verdict = el.verdict.toUpperCase()
  const result = groundingVerdictSchema.safeParse(el)
  return result.success ? result.data : null
}

export interface GroundCandidatesInput<T> {
  /** The SAME source material the extract prompt saw (quote spans must align). */
  sourceText: string
  candidates: T[]
  /** Log prefix, e.g. 'memory.layer1' / 'memory.layer2'. */
  logTag: string
}

export interface GroundCandidatesResult<T> {
  kept: T[]
  discardedCount: number
}

function buildGroundingPrompt(
  sourceText: string,
  candidates: unknown[]
): { system: string; user: string } {
  const system = `You are a grounding checker for a memory-extraction pipeline.

You receive (a) the SOURCE MATERIAL a prior extraction pass read, and (b) the list of candidate memories it produced. Extraction models sometimes invent plausible-sounding facts with no basis in the source. Your ONLY job is to verify each candidate against the source material.

For EACH candidate, by 0-based index, return one verdict object:
- {"index": N, "verdict": "SUPPORTED", "quote": "<verbatim snippet>"} — the candidate's core claim is backed by the source. "quote" MUST be a short verbatim snippet copied from the source material that supports the claim. Never write a quote that does not appear in the source.
- {"index": N, "verdict": "UNSUPPORTED"} — the source does not back the candidate's core claim (invented detail, unstated cause, speculation presented as fact).

Rules:
- Judge ONLY support-in-source, not usefulness, style, or correctness of the candidate.
- Paraphrase is fine: the candidate may reword the source. It is UNSUPPORTED only when the core factual claim (the error, the rule, the decision, the cause) is absent from the source.
- A candidate that adds a plausible cause or outcome the source never states is UNSUPPORTED, even if the inference seems reasonable.
- Return EXACTLY ONE verdict per candidate index, in a JSON object {"verdicts": [...]}. Use the key "verdict" (never "label" or "status") and the key "index".`

  const user = `# Source material
${sourceText}

# Candidates (judge each by index)
${candidates.map((c, i) => `[${i}] ${JSON.stringify(c)}`).join('\n')}

# Your output
Return {"verdicts": [...]} with exactly one verdict per candidate index (0..${candidates.length - 1}).`

  return { system, user }
}

/**
 * Run the batched quote-or-discard check. Returns the kept candidates (original
 * objects, never rewritten) plus the discard count. Never throws.
 */
export async function groundCandidates<T>(
  input: GroundCandidatesInput<T>
): Promise<GroundCandidatesResult<T>> {
  const { sourceText, candidates, logTag } = input
  if (candidates.length === 0) return { kept: [], discardedCount: 0 }

  const { system, user } = buildGroundingPrompt(sourceText, candidates)
  try {
    const { object, usage } = await generateObject({
      model: gateway(MODEL_ID),
      schema: LOOSE_GROUNDING_OUTPUT,
      system,
      prompt: user,
    })

    // Fail-open per candidate: only an explicit valid UNSUPPORTED discards.
    const unsupported = new Set<number>()
    const rawVerdicts = Array.isArray(object.verdicts) ? object.verdicts : []
    for (const raw of rawVerdicts) {
      const v = coerceGroundingVerdict(raw)
      if (v === null) {
        logger.warn(
          `[${logTag}] dropped malformed grounding verdict:`,
          JSON.stringify(raw)
        )
        continue
      }
      if (v.verdict === 'UNSUPPORTED' && v.index < candidates.length) {
        unsupported.add(v.index)
      }
    }

    const kept = candidates.filter((_, i) => !unsupported.has(i))
    // Cost + interception observability: the grounding gate doubles the number
    // of extraction-path LLM calls — this line is where that increment shows.
    logger.info(
      `[${logTag}] grounding kept=${kept.length} discarded=${unsupported.size} ` +
        `tokens(in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'})`
    )
    return { kept, discardedCount: unsupported.size }
  } catch (error) {
    logger.warn(
      `[${logTag}] grounding call failed — fail-open, keeping all ${candidates.length} candidates:`,
      error instanceof Error ? error.message : error
    )
    return { kept: candidates, discardedCount: 0 }
  }
}
