import { z } from 'zod'

/**
 * LUM-1256 — `GET /api/workspaces/me/security-scan/context?repo=owner/name
 * [&branch=<name>]`: the repository is required, the branch optional (it
 * only finds the branch's open PR).
 */
export const scanContextQuerySchema = z.object({
  repo: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^/\s]+\/[^/\s]+$/, 'must be owner/name'),
  branch: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^\s]+$/, 'must not contain whitespace')
    .optional(),
})
