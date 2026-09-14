/**
 * LUM-776 — the configurations the planner probe compares. Import-light on
 * purpose (no AI SDK): `__tests__/probe-results.test.ts` reads this to know
 * which variant the SHIPPED code corresponds to, and the jest graph must not
 * pull `ai` / `@ai-sdk/gateway` in (TransformStream trap).
 */
import { FAST_MODEL } from '../../../lib/ai/models'

export interface ProbeVariant {
  name: string
  /** Gateway model id. */
  model: string
  /** Passed through `planHuntTasks`'s probe overrides; absent = shipped call. */
  providerOptions?: Record<string, Record<string, unknown>>
  /** `old` = the pre-LUM-776 schema (reason required, max 400), measured as a control. */
  schema: 'shipped' | 'old'
  why: string
}

export const VARIANTS: readonly ProbeVariant[] = [
  {
    name: 'flash-reasoning',
    model: FAST_MODEL,
    schema: 'shipped',
    why: 'the shipped call: FAST bucket, provider default reasoning, relaxed schema',
  },
  {
    name: 'flash-reasoning-old-schema',
    model: FAST_MODEL,
    schema: 'old',
    why: 'control — the same call with the pre-LUM-776 schema (reason required, max 400)',
  },
  {
    name: 'flash-no-reasoning',
    model: FAST_MODEL,
    providerOptions: { deepseek: { reasoningEffort: 'none' } },
    schema: 'shipped',
    why: 'candidate — cheapest change: same bucket, reasoning off (LUM-766 saw 13/16 empty plans under the old caps)',
  },
  {
    name: 'haiku-4.5',
    model: 'anthropic/claude-haiku-4.5',
    schema: 'shipped',
    why: 'candidate — a non-reasoning model for what is a structured routing decision',
  },
  {
    name: 'gpt-4.1-mini',
    model: 'openai/gpt-4.1-mini',
    schema: 'shipped',
    why: 'candidate — second non-reasoning model, cheap',
  },
]

/** The variant that IS the production call — the one the acceptance test judges. */
export function shippedVariantName(): string {
  const shipped = VARIANTS.find(
    v => v.model === FAST_MODEL && !v.providerOptions && v.schema === 'shipped'
  )
  if (!shipped) throw new Error('no variant matches the shipped configuration')
  return shipped.name
}
