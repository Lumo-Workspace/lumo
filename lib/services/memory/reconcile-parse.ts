import { z } from 'zod'

/**
 * LUM-335: per-op resilient parsing for the reconcile pass (Pass 2) of the
 * two-layer memory pipeline, shared by both layers.
 *
 * Background: the reconcile LLM (deepseek-v4-flash) is asked for a flat list of
 * operations. It intermittently:
 *   (a) keys an element `{"operation":"SUPERSEDE",...}` instead of the
 *       `{"type":"SUPERSEDE",...}` discriminator the Zod schema expects, and
 *   (b) emits one malformed element in an otherwise-valid batch.
 * Previously the strict `z.discriminatedUnion('type', [...])` array schema was
 * handed straight to `generateObject`, which validates internally and THROWS on
 * the first bad element. The caller's try/catch then returned `[]` for the
 * WHOLE turn — silently losing every reconcile write for that turn.
 *
 * The fix: hand `generateObject` a LOOSE array schema (`LOOSE_RECONCILE_OUTPUT`,
 * raw objects), then validate EACH element here with the strict per-op schema,
 * dropping only the invalid elements. A single malformed op no longer nukes the
 * batch. We also alias `operation`→`type` first, recovering the exact observed
 * drift.
 */

/**
 * Loose schema passed to `generateObject` in place of the strict op-array
 * schema. Each element is an arbitrary JSON object; per-element strict
 * validation happens afterwards via {@link parseReconcileOperations}.
 */
export const LOOSE_RECONCILE_OUTPUT = z.object({
  operations: z.array(z.record(z.string(), z.unknown())).default([]),
})

/**
 * Coerce one raw op element into a valid op (or null).
 *
 * If the element carries an `operation` key but no `type` key, remap it
 * (`type = operation`, drop `operation`) — this recovers the observed
 * `{"operation":...}` drift. Then strict-parse against `opSchema`. Returns the
 * parsed op on success, or null if the element is unrecoverable garbage.
 */
export function coerceReconcileOperation<T>(
  raw: unknown,
  opSchema: z.ZodType<T>
): T | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  let candidate = raw as Record<string, unknown>
  // `operation`→`type` alias: only when `type` is absent (an explicit `type`
  // always wins; never overwrite it from a stray `operation`).
  if (!('type' in candidate) && 'operation' in candidate) {
    const { operation, ...rest } = candidate
    candidate = { type: operation, ...rest }
  }
  const result = opSchema.safeParse(candidate)
  return result.success ? result.data : null
}

/**
 * Parse a raw operations array into valid ops, dropping (and warning about) any
 * element that can't be coerced. A `null`/non-array input yields `[]`.
 *
 * @param rawOps   the `operations` array as returned by the loose generateObject
 * @param opSchema the strict per-op schema (layer1 or layer2 discriminated union)
 * @param logTag   log prefix, e.g. `'memory.layer1'`, for the drop warning
 */
export function parseReconcileOperations<T>(
  rawOps: unknown,
  opSchema: z.ZodType<T>,
  logTag: string
): T[] {
  if (!Array.isArray(rawOps)) return []
  const ops: T[] = []
  for (const raw of rawOps) {
    const op = coerceReconcileOperation(raw, opSchema)
    if (op === null) {
      console.warn(
        `[${logTag}] dropped malformed reconcile op:`,
        JSON.stringify(raw)
      )
      continue
    }
    ops.push(op)
  }
  return ops
}
