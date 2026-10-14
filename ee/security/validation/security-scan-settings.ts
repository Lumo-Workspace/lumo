import { z } from 'zod'
import { LEARNINGS_SCOPES } from '@/ee/security/security-scan/learnings-scope'
import { AUTO_PAUSE_AFTER_MAX } from '@/ee/security/security-scan/review-control'

/** LUM-1137: reviewed commits before automatic review pauses; 0 = never. */
export const autoPauseAfterSchema = z
  .number()
  .int()
  .min(0)
  .max(AUTO_PAUSE_AFTER_MAX)

/**
 * LUM-1002: the security-scan switches alone (CLI + settings card). Either
 * `all` (disable / enable every switch) or one or more single switches.
 * Moved out of lib/validation/schemas.ts in LUM-1062: it belongs to the
 * security plugin's own route.
 */
export const updateSecurityScanSettingsSchema = z
  .object({
    all: z.boolean().optional(),
    securityScanEnabled: z.boolean().optional(),
    securityAiReviewEnabled: z.boolean().optional(),
    securityHuntEnabled: z.boolean().optional(),
    // LUM-1130: the request-changes / approve workflow (default off).
    securityRequestChangesEnabled: z.boolean().optional(),
    // LUM-1134: which repositories' learnings the AI review reads.
    securityLearningsScope: z.enum(LEARNINGS_SCOPES).optional(),
    // LUM-1137: pause automatic review after N reviewed commits (0 = never).
    securityReviewAutoPauseAfter: autoPauseAfterSchema.optional(),
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, {
    message: 'Nothing to change',
  })
  .refine(v => v.all === undefined || Object.keys(v).length === 1, {
    message: '`all` cannot be combined with a single switch',
  })

/**
 * LUM-1133: one repository's automatic review settings — `repo` is
 * `owner/name`; at least one of the two switches.
 */
export const updateRepoReviewSettingsSchema = z
  .object({
    repo: z
      .string()
      .trim()
      .regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be owner/name'),
    autoReview: z.boolean().optional(),
    reviewDrafts: z.boolean().optional(),
  })
  .strict()
  .refine(v => v.autoReview !== undefined || v.reviewDrafts !== undefined, {
    message: 'Nothing to change',
  })
