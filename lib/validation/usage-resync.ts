import { z } from 'zod'
import { AGENT_ID_RE } from '@/lib/session/child-session-id'

/** LUM-932 `lumo usage resync`: at most this many sessions per request. */
export const USAGE_RESYNC_MAX_SESSIONS = 50

const tokens = z.number().int().nonnegative()

const modelUsageSchema = z
  .object({
    input: tokens,
    output: tokens,
    cacheRead: tokens,
    cacheCreation: tokens,
  })
  .strict()

const totalSchema = z
  .object({
    inputTokens: tokens,
    outputTokens: tokens,
    cacheReadTokens: tokens,
    cacheCreationTokens: tokens,
  })
  .strict()

const byModelSchema = z.record(z.string().min(1).max(200), modelUsageSchema)

const subagentUsageSchema = z
  .object({ total: totalSchema, byModel: byModelSchema })
  .strict()

const sessionSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    total: totalSchema,
    byModel: byModelSchema,
    bySubagent: z
      .record(
        z.string().regex(AGENT_ID_RE, 'invalid agent id'),
        subagentUsageSchema
      )
      .optional(),
  })
  .strict()

/** Body of POST /api/sessions/usage-resync — deduped transcript numbers only. */
export const usageResyncBodySchema = z
  .object({
    dryRun: z.boolean(),
    sessions: z.array(sessionSchema).max(USAGE_RESYNC_MAX_SESSIONS),
  })
  .strict()

export type UsageResyncBody = z.infer<typeof usageResyncBodySchema>
export type ResyncSessionInput = z.infer<typeof sessionSchema>
export type ResyncTotal = z.infer<typeof totalSchema>
