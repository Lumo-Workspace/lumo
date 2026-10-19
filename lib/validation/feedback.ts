import { z } from 'zod'
import {
  EVIDENCE_ALLOWED_TYPES,
  MAX_EVIDENCE_FILES,
} from '@/lib/validation/test-case'

/**
 * LUM-1240: request validation for `lumo feedback` (a customer or agent
 * reporting a bug / idea / question to the Lumo team).
 *
 * Field-level limits only. Business rules (rate limits, the task ref belonging
 * to the caller's workspace, credential redaction) live in
 * `lib/services/feedback.service.ts`.
 */

export const FEEDBACK_KINDS = ['BUG', 'IDEA', 'QUESTION'] as const
export const FEEDBACK_STATUSES = [
  'NEW',
  'TRIAGED',
  'RESOLVED',
  'WONTFIX',
] as const
export type FeedbackKindValue = (typeof FEEDBACK_KINDS)[number]
export type FeedbackStatusValue = (typeof FEEDBACK_STATUSES)[number]

/** Same guard rails as a test case (lib/validation/test-case.ts). */
export const MAX_FEEDBACK_TITLE_LEN = 200
export const MAX_FEEDBACK_STEPS = 30
export const MAX_FEEDBACK_STEP_LEN = 500
export const MAX_FEEDBACK_TEXT_LEN = 2000

/** Evidence types and count: the test-case rules, reused so they cannot drift. */
export const FEEDBACK_EVIDENCE_ALLOWED_TYPES = EVIDENCE_ALLOWED_TYPES
export const MAX_FEEDBACK_EVIDENCE_FILES = MAX_EVIDENCE_FILES
/**
 * Per-file size: 4 MB, not the test-case 10 MB. Measured on a preview
 * deployment (2026-10-19): a 4 MB multipart body reaches the function, a
 * 6.3 MB one is refused by the platform with 413 FUNCTION_PAYLOAD_TOO_LARGE
 * (the request-body limit is ~4.5 MB). Each file is uploaded in its own
 * request (`POST /api/feedback/[ref]/evidence`), so 4 MB leaves room for the
 * multipart overhead and the CLI can refuse a bigger file locally.
 */
export const FEEDBACK_EVIDENCE_MAX_BYTES = 4 * 1024 * 1024
/** Evidence can be attached only shortly after submitting, by the submitter. */
export const FEEDBACK_EVIDENCE_ATTACH_WINDOW_MS = 15 * 60_000

/**
 * Submission limits (user ruling 2026-10-19, RFC Q8). Counted from the
 * Feedback table itself, so they hold across instances and deploys; a failed
 * count refuses the submission (fail closed).
 */
export const FEEDBACK_LIMITS = [
  { scope: 'member', window: 'burst', max: 5, windowMs: 10 * 60_000 },
  { scope: 'workspace', window: 'burst', max: 20, windowMs: 10 * 60_000 },
  { scope: 'member', window: 'daily', max: 20, windowMs: 24 * 3_600_000 },
  { scope: 'workspace', window: 'daily', max: 50, windowMs: 24 * 3_600_000 },
] as const
export type FeedbackLimit = (typeof FEEDBACK_LIMITS)[number]

/** `process.platform` values. */
const PLATFORMS = [
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
] as const

/** Same values as the Prisma `TaskArtifactAgent` enum. */
export const FEEDBACK_AGENT_HOSTS = [
  'CLAUDE_CODE',
  'CODEX',
  'CURSOR',
  'GEMINI_CLI',
  'GITHUB_COPILOT',
  'WINDSURF',
] as const

/** A leaf command path such as `task testcase run` — words only, no values. */
export const COMMAND_PATH_RE = /^[a-z][a-z-]*( [a-z][a-z-]*){0,3}$/
/** A long flag name such as `--evidence-file` — never its value. */
export const FLAG_NAME_RE = /^--[a-z][a-z0-9-]{0,40}$/

/**
 * The client environment, whitelisted. `.strict()` everywhere: an extra key —
 * or a value that is not the documented shape — is a 400, so even a modified
 * CLI cannot smuggle code, a diff or a transcript in here.
 */
export const feedbackEnvironmentSchema = z
  .object({
    cliVersion: z
      .string()
      .regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}([-+][0-9A-Za-z.-]{1,32})?$/)
      .nullable(),
    os: z.enum(PLATFORMS),
    osRelease: z
      .string()
      .regex(/^[0-9A-Za-z._+-]{1,64}$/)
      .nullable(),
    arch: z
      .string()
      .regex(/^[a-z0-9_]{1,16}$/)
      .nullable(),
    nodeVersion: z
      .string()
      .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/)
      .nullable(),
    agentHost: z.enum(FEEDBACK_AGENT_HOSTS).nullable(),
    lastCommand: z
      .object({
        command: z.string().max(80).regex(COMMAND_PATH_RE),
        flags: z.array(z.string().regex(FLAG_NAME_RE)).max(30),
        exitCode: z.number().int().min(0).max(255),
        at: z.string().datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export type FeedbackEnvironment = z.infer<typeof feedbackEnvironmentSchema>

const upper = (v: unknown) => (typeof v === 'string' ? v.toUpperCase() : v)

/** The JSON `payload` part of `POST /api/feedback` (files are separate parts). */
export const createFeedbackPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_FEEDBACK_TITLE_LEN),
    kind: z.preprocess(upper, z.enum(FEEDBACK_KINDS)).default('BUG'),
    steps: z
      .array(z.string().trim().min(1).max(MAX_FEEDBACK_STEP_LEN))
      .max(MAX_FEEDBACK_STEPS)
      .default([]),
    expected: z.string().trim().min(1).max(MAX_FEEDBACK_TEXT_LEN).nullish(),
    actual: z.string().trim().min(1).max(MAX_FEEDBACK_TEXT_LEN).nullish(),
    /** Task ref text only, e.g. LUM-1185. */
    task: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{1,10}-\d{1,9}$/)
      .nullish(),
    /** Absent / null = the submitter turned it off (--no-env). */
    environment: feedbackEnvironmentSchema.nullish(),
  })
  .strict()

export type CreateFeedbackPayload = z.infer<typeof createFeedbackPayloadSchema>

export const listFeedbackQuerySchema = z.object({
  status: z.preprocess(upper, z.enum(FEEDBACK_STATUSES)).optional(),
  kind: z.preprocess(upper, z.enum(FEEDBACK_KINDS)).optional(),
  mine: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform(v => v === 'true' || v === '1'),
  // The CLI paging contract (DEFAULT_PAGE_SIZE / MAX_PAGE_SIZE, LUM-1093).
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().max(64).optional(),
})

export type ListFeedbackQuery = z.infer<typeof listFeedbackQuerySchema>

/** `FB-12` or `12` → 12; anything else → null. */
export function parseFeedbackRef(ref: string): number | null {
  const m = /^(?:FB-)?(\d{1,9})$/i.exec(ref.trim())
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? n : null
}

// ── Staff side (LUM-1240 batch 2) ───────────────────────────────────────

/** A staff reply, as long as the RFC allows (FeedbackReply.body ≤ 4000). */
export const MAX_FEEDBACK_REPLY_LEN = 4000

/** `GET /api/staff/feedback` — every workspace, or one by id. */
export const staffListFeedbackQuerySchema = z.object({
  status: z.preprocess(upper, z.enum(FEEDBACK_STATUSES)).optional(),
  kind: z.preprocess(upper, z.enum(FEEDBACK_KINDS)).optional(),
  workspace: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().max(64).optional(),
})

export type StaffListFeedbackQuery = z.infer<
  typeof staffListFeedbackQuerySchema
>

/**
 * `PATCH /api/staff/feedback/<seq>` — a status change, a reply, or both in
 * one transaction. At least one is required.
 */
export const staffUpdateFeedbackSchema = z
  .object({
    status: z.preprocess(upper, z.enum(FEEDBACK_STATUSES)).optional(),
    reply: z.string().trim().min(1).max(MAX_FEEDBACK_REPLY_LEN).optional(),
  })
  .strict()
  .refine(v => v.status !== undefined || v.reply !== undefined, {
    message: 'Give a status, a reply, or both',
  })

export type StaffUpdateFeedback = z.infer<typeof staffUpdateFeedbackSchema>

/** The staff handle `#12` or `12` → 12; anything else → null. */
export function parseStaffFeedbackRef(ref: string): number | null {
  const m = /^#?(\d{1,9})$/.exec(ref.trim())
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? n : null
}
