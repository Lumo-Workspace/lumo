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

/**
 * Payload for `POST /api/plan-runs/[runId]/gate/materialize` — Gate C (闸门C,
 * LUM-671) accepting a DRAFT_READY plan run.
 *
 * The human has, at Gate C, edited the prose document, ticked each drafted task
 * keep/strike, and picked the project the materialised tasks land in. The whole
 * confirmed state is submitted here (not a diff): the server freezes it onto the
 * GENERATE stage record's `humanConfirmedOutput` (the "人改了什么" training
 * signal) and materialises it in one transaction.
 *
 * `tasks` carries EVERY drafted task with an explicit `keep` flag rather than
 * pre-filtering to the kept ones — so the frozen confirmed output records what
 * was struck too, and the server (not the client) decides what gets created.
 * `ideaIds` are the ideas the cluster behind this draft consumed; the service
 * validates them against the run's frozen `inputIdeaIds` before linking them to
 * the created Initiative.
 */

const materializeTaskSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required').max(500),
  why: z.string().trim().max(2000),
  size: z.enum(['S', 'M', 'L']),
  /** Kept (checked) → materialised into a Task; struck (unchecked) → skipped. */
  keep: z.boolean(),
})

const materializeDraftSchema = z.object({
  /** Echoed from the Stage-3 draft — identifies the draft in the frozen output. */
  clusterId: z.string().trim().min(1),
  goalStatement: z
    .string()
    .trim()
    .min(1, 'Goal statement is required')
    .max(2000),
  assumptionNote: z.string().trim().max(2000).nullable().optional(),
  /** Ids of the ideas this draft consumed (⊆ the run's frozen inputIdeaIds). */
  ideaIds: z.array(z.string().trim().min(1)),
  tasks: z.array(materializeTaskSchema),
})

export const materializePlanSchema = z.object({
  /** The project the materialised tasks land in (Gate C picker; D4). */
  projectId: z.string().trim().min(1, 'A project is required'),
  /** The human-edited prose document — frozen onto PlanRun.proseDocument. */
  proseDocument: z.string().max(50000),
  drafts: z
    .array(materializeDraftSchema)
    .min(1, 'At least one draft is required'),
})

export type MaterializePlanInput = z.infer<typeof materializePlanSchema>
export type MaterializeDraftInput = z.infer<typeof materializeDraftSchema>
export type MaterializeTaskInput = z.infer<typeof materializeTaskSchema>

/**
 * Payload for `POST /api/plan-runs/[runId]/gate/cluster` — confirming gate A
 * (闸门A). The reviewer submits the full edited clustering (renamed clusters +
 * ideas moved between clusters/orphans) plus the `ifRevision` they loaded, for
 * optimistic-concurrency (cf. doc LUM-409). Shape mirrors the Stage-1
 * `PlanClusterOutput`; the deeper integrity rule (the edit must partition the
 * original idea set exactly) is a business invariant enforced in the service,
 * not here.
 */
const clusterEditSchema = z.object({
  name: z.string().min(1, 'A cluster name is required'),
  thrust: z.string(),
  ideaIds: z.array(z.string().min(1)),
})

export const confirmClusterGateSchema = z.object({
  clusters: z.array(clusterEditSchema),
  orphans: z.array(z.string().min(1)),
  ifRevision: z.number().int().nonnegative(),
})

export type ConfirmClusterGateInput = z.infer<typeof confirmClusterGateSchema>
