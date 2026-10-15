import { z } from 'zod'
import { baseBranchRegExp } from '@/ee/security/security-scan/auto-review-policy'
import { invalidPathFilter } from '@/ee/security/security-scan/reviewable-path'
import {
  pathInstructionEntrySchema,
  REVIEW_FILTER_MAX_ENTRIES,
  REVIEW_FILTER_MAX_ENTRY_CHARS,
  reviewProfileSchema,
  toneInstructionsSchema,
} from './security-scan-settings'
import {
  PRE_MERGE_CHECK_INSTRUCTIONS_MAX,
  PRE_MERGE_CHECK_MODES,
  PRE_MERGE_CHECK_NAME_MAX,
  PRE_MERGE_CUSTOM_CHECKS_MAX,
} from '@/ee/security/security-scan/pre-merge-checks'
import { PATH_INSTRUCTIONS_MAX_ENTRIES } from '@/ee/security/security-scan/path-instructions'

/**
 * LUM-1146 — the repository config file (`.lumo.yaml` at the repository
 * root): ONE Zod schema for every key the file may hold. The JSON schema
 * editors read (`public/schemas/lumo-yaml.schema.json`) is generated from
 * it (`npx tsx scripts/security/emit-repo-config-schema.ts`; a test keeps the
 * two equal).
 *
 * Extension point — adding a key or a whole section:
 *  1. add it to the schema below (snake_case, `.optional()`, a
 *     `.describe()` — the description is what editors show);
 *  2. register how it resolves in `REPO_CONFIG_FIELDS`
 *     (ee/security/security-scan/repo-config.ts): the file value, the Lumo
 *     setting it overrides (if any), its default, and what a PR-branch copy
 *     may do with it;
 *  3. regenerate the JSON schema.
 * Unknown keys never fail the file — they are reported as warnings — so an
 * older Lumo reading a newer file degrades to "ignored key", not "invalid".
 */

export const REPO_CONFIG_PATH = '.lumo.yaml'

/** A larger file is refused unparsed (a config file is a few hundred bytes). */
export const REPO_CONFIG_MAX_BYTES = 64 * 1024

const entry = z
  .string()
  .max(REVIEW_FILTER_MAX_ENTRY_CHARS)
  .refine(v => !/[\n\r]/.test(v), 'must be a single line')

const list = (item: z.ZodType<string> = entry) =>
  z.array(item).max(REVIEW_FILTER_MAX_ENTRIES)

export const autoReviewConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe(
        'Review every PR of the repository automatically. When false, only a PR carrying one of `labels` or whose description contains `description_keyword` is reviewed.'
      ),
    drafts: z
      .boolean()
      .optional()
      .describe('Review draft PRs too (otherwise they wait until ready).'),
    base_branches: list(
      entry.refine(
        v => baseBranchRegExp(v.trim()) !== null,
        'must be a valid regular expression'
      )
    )
      .optional()
      .describe(
        'Regular expressions (full match) for base branches besides the default branch whose PRs are reviewed; `.*` = every branch.'
      ),
    labels: list()
      .optional()
      .describe(
        '`label` reviews only PRs carrying one of the listed labels; `!label` never reviews a PR carrying it.'
      ),
    ignore_title_keywords: list()
      .optional()
      .describe(
        'A PR whose title contains one of these (case-insensitive) is not reviewed automatically.'
      ),
    ignore_usernames: list()
      .optional()
      .describe(
        'PRs by these GitHub logins (exact, case-sensitive) are never reviewed automatically.'
      ),
    description_keyword: entry
      .nullable()
      .optional()
      .describe(
        'With `enabled: false`, a PR whose description contains this is reviewed. Empty or null clears it.'
      ),
  })
  .describe(
    'Which PRs without a Lumo task are reviewed automatically. PRs linked to a Lumo task are always scanned.'
  )

const checkMode = z
  .enum(PRE_MERGE_CHECK_MODES)
  .describe(
    '`off` = not run; `warning` = a failure is reported; `error` = a failure also keeps Lumo at "Changes requested" (request-changes workflow on) until fixed or overridden on the PR.'
  )

/** LUM-1148 — the pre-merge checks. */
export const preMergeChecksConfigSchema = z
  .object({
    title: z
      .object({
        mode: checkMode.optional(),
        requirements: z
          .string()
          .max(PRE_MERGE_CHECK_INSTRUCTIONS_MAX)
          .optional()
          .describe(
            'Extra rules the PR title must meet, in plain language (e.g. "start with feat:, fix: or chore:").'
          ),
      })
      .optional()
      .describe(
        'Built-in check: the PR title is concise and describes the change.'
      ),
    description: z
      .object({ mode: checkMode.optional() })
      .optional()
      .describe(
        "Built-in check: the PR description is filled in (and follows the repository's pull request template, if any)."
      ),
    custom_checks: z
      .array(
        z.object({
          name: z
            .string()
            .max(PRE_MERGE_CHECK_NAME_MAX)
            .refine(v => !/[\n\r]/.test(v), 'must be a single line')
            .refine(v => v.trim().length > 0, 'must not be empty')
            .describe('Shown in the PR summary; unique per repository.'),
          mode: checkMode.optional().describe('Default `warning`.'),
          instructions: z
            .string()
            .max(PRE_MERGE_CHECK_INSTRUCTIONS_MAX)
            .refine(v => v.trim().length > 0, 'must not be empty')
            .describe('The rule, in plain language.'),
        })
      )
      .max(PRE_MERGE_CUSTOM_CHECKS_MAX)
      .refine(
        list =>
          new Set(list.map(c => c.name.trim().toLowerCase())).size ===
          list.length,
        'check names must be unique'
      )
      .optional()
      .describe(
        "The repository's own checks, in natural language. Replaces the checks set in Lumo."
      ),
    override_requested_reviewers_only: z
      .boolean()
      .optional()
      .describe(
        "Only the PR's requested reviewers (never its author) may run `ignore pre-merge checks`."
      ),
  })
  .describe(
    'Pre-merge checks, reported in the PR summary. Overriding them never clears a finding that blocks DONE.'
  )

export const reviewsConfigSchema = z
  .object({
    auto_review: autoReviewConfigSchema.optional(),
    path_filters: list(
      entry.refine(
        v => v.trim() === '' || invalidPathFilter(v.trim()) === null,
        'must be a glob (`!glob` excludes)'
      )
    )
      .optional()
      .describe(
        'Globs for the files the AI review reads: `!glob` excludes; once any `glob` is listed, only matching files are reviewed.'
      ),
    pre_merge_checks: preMergeChecksConfigSchema.optional(),
    profile: reviewProfileSchema
      .optional()
      .describe(
        'Which findings get inline comments: `quiet` = only HIGH and Done-blocking ones (MEDIUM listed in the summary), `chill` (default) = HIGH and MEDIUM, `assertive` = LOW too. Detection and what blocks DONE are the same in every profile.'
      ),
    path_instructions: z
      .array(
        pathInstructionEntrySchema.describe(
          'Extra instructions for the AI review of files matching `path`.'
        )
      )
      .max(PATH_INSTRUCTIONS_MAX_ENTRIES)
      .optional()
      .describe(
        'Review instructions per path glob, added to the AI review of matching files (on top of its built-in review; they cannot turn a check off).'
      ),
  })
  .describe('Code review settings.')

export const repoConfigSchema = z
  .object({
    version: z
      .literal(1)
      .optional()
      .describe('Schema version of this file. Currently 1.'),
    reviews: reviewsConfigSchema.optional(),
    tone_instructions: toneInstructionsSchema
      .optional()
      .describe(
        'How the AI review words its findings and PR description, and how Lumo words its answers on the PR (at most 250 characters), e.g. "Be concise and friendly". Changes wording only, never what is reported.'
      ),
  })
  .describe(
    'Lumo repository configuration (.lumo.yaml). Read from the base branch of each pull request.'
  )

export type RepoConfigFile = z.infer<typeof repoConfigSchema>

/** Where the generated JSON schema is committed (served at `/schemas/…`). */
export const REPO_CONFIG_JSON_SCHEMA_PATH =
  'public/schemas/lumo-yaml.schema.json'

/** The JSON schema editors validate `.lumo.yaml` against (generated, never hand-edited). */
export function repoConfigJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(repoConfigSchema, { io: 'input' }),
    title: '.lumo.yaml',
  }
}
