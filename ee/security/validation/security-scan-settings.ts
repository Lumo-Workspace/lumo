import { z } from 'zod'

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
  })
  .strict()
  .refine(v => Object.keys(v).length > 0, {
    message: 'Nothing to change',
  })
  .refine(v => v.all === undefined || Object.keys(v).length === 1, {
    message: '`all` cannot be combined with a single switch',
  })
