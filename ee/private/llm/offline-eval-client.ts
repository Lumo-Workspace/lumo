import { generateObject, type ModelMessage } from 'ai'
import type { z } from 'zod'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'

/**
 * LUM-984 — the one model call the offline boundary-crossing experiments
 * (internal LUM-945 / LUM-958 / LUM-965 evaluations) make. They used to
 * import `generateObject` from `ai` directly; routing them through this
 * wrapper keeps the `ai` import inside `lib/` and every call on the ZDR
 * gateway (`@/lib/ai/gateway`).
 *
 * Deterministic and single-shot on purpose: temperature 0 and no SDK
 * retries — each experiment owns its retry / fatal-error policy and records
 * a failed call as "not flagged".
 */

export type EvalMessage = ModelMessage

export interface EvalObjectRequest<S extends z.ZodTypeAny> {
  /** Gateway model id, e.g. `anthropic/claude-sonnet-4.6`. */
  model: string
  schema: S
  system: string
  /** Exactly one of `prompt` / `messages`. */
  prompt?: string
  messages?: EvalMessage[]
  maxOutputTokens: number
  timeoutMs: number
  /** Called with the raw text when it does not parse; null = give up. */
  repairText?: (text: string) => string | null
}

export interface EvalObjectResult<T> {
  object: T
  usage: {
    inputTokens?: number
    outputTokens?: number
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  }
  providerMetadata: unknown
}

export async function generateEvalObject<S extends z.ZodTypeAny>(
  req: EvalObjectRequest<S>
): Promise<EvalObjectResult<z.infer<S>>> {
  const common = {
    model: gateway(req.model),
    schema: req.schema,
    system: req.system,
    maxOutputTokens: req.maxOutputTokens,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(req.timeoutMs),
    experimental_repairText: async ({ text }: { text: string }) =>
      req.repairText ? req.repairText(text) : null,
  }
  const r = req.messages
    ? await generateObject({ ...common, messages: req.messages })
    : await generateObject({ ...common, prompt: req.prompt ?? '' })
  return {
    object: r.object as z.infer<S>,
    usage: r.usage as EvalObjectResult<z.infer<S>>['usage'],
    providerMetadata: r.providerMetadata,
  }
}
