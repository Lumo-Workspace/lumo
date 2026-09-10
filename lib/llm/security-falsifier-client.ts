/**
 * LUM-739 — the falsifier (spec §6 L3 "Verify" step 2, principle P2). Given
 * a mechanically verified candidate plus the code around its entry and sink,
 * it tries to REFUTE the claim; when it cannot, the answer is INCONCLUSIVE.
 * It never confirms, and it is never shown the hunter's reasoning — only the
 * claim, its precondition, the chain and the code.
 *
 * Static imports of `ai` / `@ai-sdk/gateway`: reach this module only via
 * `await import()` from service code. REASONING_MODEL (桶1 VERIFIER): an
 * adversarial judgment that must not be downgraded.
 */
import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { VerifiedCandidate } from '@/lib/security-scan/hunt/mechanical-verify'

export interface FalsifierClientInput {
  candidate: VerifiedCandidate
  /** Numbered lines around the entry / sink at the head sha. */
  entrySnippet: string
  sinkSnippet: string
}

export interface FalsifierClientOutput {
  verdict: 'REJECT' | 'INCONCLUSIVE'
  reason: string
  tokens: number
}

const FalsifierSchema = z.object({
  verdict: z.enum(['REJECT', 'INCONCLUSIVE']),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'REJECT: the concrete reason the claim cannot hold. INCONCLUSIVE: what you checked and could not refute.'
    ),
})

export const FALSIFIER_SYSTEM_PROMPT = `You are a falsifier. You receive a security claim about a code path in a TypeScript repository, its precondition, the call chain, and the code around the entry point and the sink.

Your ONLY two outputs are:
- REJECT — you can point at a concrete reason the claim cannot hold: an existing mitigation on the path (authentication, authorization, schema validation, parameterisation, allow-list, transaction or unique constraint), dead or test-only code, a type or schema that makes the precondition impossible, or a call chain that cannot carry attacker input.
- INCONCLUSIVE — you looked and could not refute it.

You never confirm a vulnerability, never rate it, and never propose a fix. Be specific in the reason; cite the line that refutes the claim when you REJECT.`

const FALSIFIER_TIMEOUT_MS = 90_000

export async function falsifyCandidate(
  input: FalsifierClientInput
): Promise<FalsifierClientOutput> {
  const c = input.candidate
  const chain = c.call_chain.map(e => `${e.from} -> ${e.to}`).join('\n')
  const prompt = [
    `Category: ${c.category} (${c.cwe})`,
    `Claim: ${c.claim}`,
    `Precondition: ${c.precondition}`,
    `Entry: ${c.entry.symbol} (${c.entry.file}:${c.entry.line})`,
    `Sink: ${c.sink.symbol} (${c.sink.file}:${c.sink.line})`,
    `Reachability from an entry without a control on the path: ${c.reachability}`,
    `Call chain:\n${chain}`,
    `\n## Code around the entry (${c.entry.file})\n${input.entrySnippet}`,
    `\n## Code around the sink (${c.sink.file})\n${input.sinkSnippet}`,
  ].join('\n')
  const { object, usage } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: FalsifierSchema,
    system: FALSIFIER_SYSTEM_PROMPT,
    prompt,
    abortSignal: AbortSignal.timeout(FALSIFIER_TIMEOUT_MS),
  })
  return {
    verdict: object.verdict,
    reason: object.reason,
    tokens: usage.totalTokens ?? 0,
  }
}
