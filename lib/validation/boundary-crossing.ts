import { z } from 'zod'

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/disposition (LUM-435/450).
 * Strict — a smuggled extra field is a 400, not a silent pass. The note is
 * optional: dispositioning a CONFIRMED crossing with no note must succeed.
 *
 * `OPEN` (LUM-450) is the re-disposition sentinel for reverting a dispositioned
 * crossing back to undispositioned — it is NOT a stored disposition enum value
 * (the Prisma enum stays FALSE_POSITIVE | CONFIRMED); the route maps it to a
 * null disposition so the DONE gate re-blocks on the crossing.
 */
export const dispositionBoundaryCrossingSchema = z
  .object({
    crossingId: z.string().min(1),
    disposition: z.enum(['FALSE_POSITIVE', 'CONFIRMED', 'OPEN']),
    dispositionNote: z.string().trim().min(1).max(2000).optional(),
    // LUM-751: opt a FALSE_POSITIVE into a per-repository suppression rule
    // (ignored for any other disposition). The service refuses the HIGH
    // classes with 422 before anything is written.
    suppressSimilarInProject: z.boolean().optional(),
    suppressionReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()

export type DispositionBoundaryCrossingInput = z.infer<
  typeof dispositionBoundaryCrossingSchema
>

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/[crossingId]/remediation
 * (LUM-435). The crossing id is a path param; the body carries nothing required.
 */
export const spawnRemediationSchema = z.object({}).strict()

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/[crossingId]/explain
 * (LUM-542) — an agent appends a self-explanation ("申辩"). Strict and minimal:
 * the ONLY field is the note. There is deliberately no disposition field here —
 * the schema itself makes a disposition write unrepresentable on this route.
 * The crossing id is a path param.
 */
export const explainBoundaryCrossingSchema = z
  .object({
    note: z.string().trim().min(1).max(4000),
  })
  .strict()

export type ExplainBoundaryCrossingInput = z.infer<
  typeof explainBoundaryCrossingSchema
>

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/[crossingId]/disposition
 * (LUM-769) — the CLI/agent-bearer disposition path that walks the exit-4
 * confirmation protocol (`lumo crossing disposition … --confirm`). Strict and
 * narrower than the web schema on purpose: only the two clearing values are
 * representable. The `OPEN` revert sentinel and the LUM-751 repository
 * suppression opt-in are NOT fields here — both stay web-only, so a bearer
 * caller cannot reopen a crossing or write a project-wide rule from a terminal.
 * The crossing id is a path param.
 */
export const cliDispositionBoundaryCrossingSchema = z
  .object({
    disposition: z.enum(['FALSE_POSITIVE', 'CONFIRMED']),
    dispositionNote: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()

export type CliDispositionBoundaryCrossingInput = z.infer<
  typeof cliDispositionBoundaryCrossingSchema
>
