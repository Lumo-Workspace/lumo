import { z } from 'zod'
import { LEARNINGS_SCOPES } from '@/ee/security/security-scan/learnings-scope'
import { AUTO_PAUSE_AFTER_MAX } from '@/ee/security/security-scan/review-control'
import { baseBranchRegExp } from '@/ee/security/security-scan/auto-review-policy'
import { invalidPathFilter } from '@/ee/security/security-scan/reviewable-path'

/** LUM-1143: entries per filter list, and characters per entry. */
export const REVIEW_FILTER_MAX_ENTRIES = 50
export const REVIEW_FILTER_MAX_ENTRY_CHARS = 200

const filterEntry = z
  .string()
  .max(REVIEW_FILTER_MAX_ENTRY_CHARS)
  .refine(v => !/[\n\r]/.test(v), 'must be a single line')
const filterList = (entry: z.ZodType<string> = filterEntry) =>
  z.array(entry).max(REVIEW_FILTER_MAX_ENTRIES)

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
    // LUM-1142: the PR's author may resolve / approve by command (default on).
    securityAllowAuthorApproval: z.boolean().optional(),
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
 * `owner/name`; at least one setting (switches, or the LUM-1143 filters).
 */
export const updateRepoReviewSettingsSchema = z
  .object({
    repo: z
      .string()
      .trim()
      .regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be owner/name'),
    autoReview: z.boolean().optional(),
    reviewDrafts: z.boolean().optional(),
    // LUM-1143: the auto-review filters; each list replaces the
    // stored one ([] clears it).
    baseBranches: filterList(
      filterEntry.refine(
        v => baseBranchRegExp(v.trim()) !== null,
        'must be a valid regular expression'
      )
    ).optional(),
    labels: filterList().optional(),
    ignoreTitleKeywords: filterList().optional(),
    ignoreUsernames: filterList().optional(),
    // '' or null clears it.
    descriptionKeyword: filterEntry.nullable().optional(),
    pathFilters: filterList(
      filterEntry.refine(
        v => v.trim() === '' || invalidPathFilter(v.trim()) === null,
        'must be a glob (`!glob` excludes)'
      )
    ).optional(),
  })
  .strict()
  .refine(v => Object.keys(v).some(k => k !== 'repo'), {
    message: 'Nothing to change',
  })
