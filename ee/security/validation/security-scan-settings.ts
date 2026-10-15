import { z } from 'zod'
import { LEARNINGS_SCOPES } from '@/ee/security/security-scan/learnings-scope'
import { AUTO_PAUSE_AFTER_MAX } from '@/ee/security/security-scan/review-control'
import { baseBranchRegExp } from '@/ee/security/security-scan/auto-review-policy'
import { invalidPathFilter } from '@/ee/security/security-scan/reviewable-path'
import {
  PRE_MERGE_CHECK_INSTRUCTIONS_MAX,
  PRE_MERGE_CHECK_MODES,
  PRE_MERGE_CHECK_NAME_MAX,
  PRE_MERGE_CUSTOM_CHECKS_MAX,
} from '@/ee/security/security-scan/pre-merge-checks'

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

/** LUM-1148: one natural-language pre-merge check. */
export const customPreMergeCheckSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(PRE_MERGE_CHECK_NAME_MAX)
      .refine(v => !/[\n\r]/.test(v), 'must be a single line'),
    mode: z.enum(PRE_MERGE_CHECK_MODES).default('warning'),
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(PRE_MERGE_CHECK_INSTRUCTIONS_MAX),
  })
  .strict()

/** LUM-1148: a partial change to a repository's pre-merge checks. */
export const preMergeChecksUpdateSchema = z
  .object({
    title: z
      .object({
        mode: z.enum(PRE_MERGE_CHECK_MODES).optional(),
        // '' or null clears them.
        requirements: z
          .string()
          .max(PRE_MERGE_CHECK_INSTRUCTIONS_MAX)
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    description: z
      .object({ mode: z.enum(PRE_MERGE_CHECK_MODES).optional() })
      .strict()
      .optional(),
    // Replaces the list ([] clears it).
    customChecks: z
      .array(customPreMergeCheckSchema)
      .max(PRE_MERGE_CUSTOM_CHECKS_MAX)
      .refine(
        list =>
          new Set(list.map(c => c.name.toLowerCase())).size === list.length,
        'check names must be unique'
      )
      .optional(),
    overrideRequestedReviewersOnly: z.boolean().optional(),
  })
  .strict()

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
    // LUM-1148: the pre-merge checks.
    preMergeChecks: preMergeChecksUpdateSchema.optional(),
  })
  .strict()
  .refine(v => Object.keys(v).some(k => k !== 'repo'), {
    message: 'Nothing to change',
  })
