/**
 * LUM-1304 — gateway routing for a structured (`generateObject`) call: the
 * hosts of `STRUCTURED_OUTPUT_HOSTS` as both `order` (tried in turn when one
 * errors) and `only` (never a host that ignores the schema). A model with no
 * entry gets no options, so the gateway routes it as before.
 *
 * Composes with the ZDR wire guard (`zdr-fetch.ts`): ZDR is still forced on,
 * and a model pinned in `MODEL_PROVIDER_PINS` has its `only` overwritten by
 * the pin there — so this can narrow routing, never widen it.
 *
 * Pure (no SDK import), so it is unit-testable without the gateway.
 */
import { STRUCTURED_OUTPUT_HOSTS } from './models'

export function structuredOutputProviderOptions(
  modelId: string
): { gateway: { order: string[]; only: string[] } } | undefined {
  const hosts = STRUCTURED_OUTPUT_HOSTS[modelId]
  if (!hosts || hosts.length === 0) return undefined
  return { gateway: { order: [...hosts], only: [...hosts] } }
}
