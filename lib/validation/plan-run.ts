import { z } from 'zod'

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
