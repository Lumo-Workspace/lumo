import { z } from 'zod'
import { ALIGN_VERDICTS, MAX_STARRED } from '@/lib/plan-run/gate-b'

/**
 * Payload for `POST /api/plan-runs` — starting a design-thinking 转换器 run
 * (LUM-668, `lumo plan`). The only field is the run-lock override:
 * `abandonActive` first abandons the team's existing active run before
 * starting a fresh one. Absent/false → the service refuses with 409 when a run
 * is already active. The input snapshot (ideas + priority) is frozen
 * server-side, so the request carries no run inputs.
 */
export const startPlanRunSchema = z.object({
  abandonActive: z.boolean().optional(),
})

export type StartPlanRunInput = z.infer<typeof startPlanRunSchema>

/**
 * Gate B (闸门B) confirm payload. The web board sends back one entry per cluster
 * the align stage produced: the (possibly switched) three-way verdict, the
 * (possibly edited) one-line rationale, and whether the human starred it.
 *
 * Cross-field rules enforced here (return 400 via `zodError` before any DB
 * work): a star is only legal on an ALIGNED cluster, and at most `MAX_STARRED`
 * clusters may be starred. Which clusterIds are valid — and that the full set
 * is present — is checked in the service against the frozen ALIGN record.
 */
export const confirmAlignGateSchema = z
  .object({
    clusters: z
      .array(
        z.object({
          clusterId: z.string().min(1),
          verdict: z.enum(ALIGN_VERDICTS),
          starred: z.boolean(),
          rationale: z.string(),
        })
      )
      .min(1, 'at least one cluster verdict is required'),
  })
  .superRefine((val, ctx) => {
    const starred = val.clusters.filter(c => c.starred)
    if (starred.length > MAX_STARRED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `at most ${MAX_STARRED} clusters may be starred`,
        path: ['clusters'],
      })
    }
    val.clusters.forEach((c, i) => {
      if (c.starred && c.verdict !== 'ALIGNED') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'only an ALIGNED cluster may be starred',
          path: ['clusters', i, 'starred'],
        })
      }
    })
  })

export type ConfirmAlignGateInput = z.infer<typeof confirmAlignGateSchema>
