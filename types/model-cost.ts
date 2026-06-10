/**
 * Sentinel `ModelCost.model` value for tokens that have been reported by a
 * mid-turn usage event (POST_TOOL_BATCH, LUM-345) but not yet settled into
 * `Session.usageByModel` by a STOP anchor — mid-turn payloads carry no
 * per-model split, so the burn cannot be attributed to a model yet. The row
 * disappears on its own once the turn STOPs and the delta settles.
 *
 * Lives in types/ (not lib/services/) because both the timeline service and
 * client components need it, and lib/services/* is server-only by convention.
 */
export const IN_FLIGHT_MODEL = '__in_flight__'
