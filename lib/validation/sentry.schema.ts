import { z } from 'zod'

// ─── Sentry ────────────────────────────────────────────────────────────────

const ORG_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/

export const connectSentrySchema = z.object({
  orgSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(ORG_SLUG, 'Invalid Sentry organization slug'),
  clientSecret: z.string().min(10).max(256),
})

export type ConnectSentryInput = z.infer<typeof connectSentrySchema>

export const createMappingSchema = z.object({
  sentryProjectSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(ORG_SLUG, 'Invalid Sentry project slug'),
  projectId: z.string().min(1),
})

export type CreateMappingInput = z.infer<typeof createMappingSchema>
