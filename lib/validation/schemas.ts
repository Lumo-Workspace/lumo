import { z } from 'zod'
import { taskTemplateKeySchema } from '@/lib/validation/task-template'

/**
 * Max length for rich-text body fields (HTML serialized client-side).
 *
 * Task / Milestone / Project descriptions and Document content all share this
 * single cap — they live in unbounded Postgres `text` columns and use the same
 * rich-text editor. Keep this the single source of truth — do not reintroduce
 * per-field literals.
 *
 * 3M chars is a deliberate guardrail, NOT a storage limit: it sits well under
 * the platform request-body limit (Vercel serverless ~4.5MB) so a request this
 * large is rejected at the edge anyway, while still bounding parse/memory cost
 * (UTF-16 → ~6MB) and never rejecting a realistic document.
 *
 * Note: AI-input guards (suggestPriority, generateDescription, priority-override
 * snapshots) intentionally keep a smaller, separate bound — they gate what is
 * sent to an LLM, not what is persisted.
 */
const RICH_TEXT_MAX_LENGTH = 3_000_000

// ─── Reserved slugs (routes that conflict with workspace URLs) ──────────────

const RESERVED_SLUGS = [
  'admin',
  'api',
  'www',
  'app',
  'login',
  'signup',
  'dashboard',
  'settings',
  'onboarding',
  'signin',
  'signup',
  'workspace',
]

// ─── Workspace ──────────────────────────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .regex(
      /^[A-Za-z0-9 _-]+$/,
      'Name can only contain English letters, numbers, spaces, hyphens, and underscores'
    ),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug must be at most 50 characters')
    .regex(
      /^[a-z0-9-]+$/,
      'Slug can only contain lowercase letters, numbers, and hyphens'
    )
    .refine(
      s => !s.startsWith('-') && !s.endsWith('-'),
      'Slug cannot start or end with a hyphen'
    )
    .refine(s => !RESERVED_SLUGS.includes(s), 'This slug is reserved')
    .optional(),
  summaryEnabled: z.boolean().optional(),
  summaryFrequency: z.enum(['DAILY', 'EVERY_TWO_DAYS', 'WEEKLY']).optional(),
  summaryLocale: z.string().max(10).optional(),
})

/** LUM-918: the two kinds of item the trash holds (a route segment). */
export const trashKindSchema = z.enum(['task', 'document'])

/** LUM-917: deleting AI-derived content needs the workspace name re-typed. */
export const purgeAiDerivedContentSchema = z.object({
  confirmName: z.string().min(1).max(200),
})

/** LUM-944: one pass of deleting a session's raw record; `after` resumes a pass. */
export const deleteSessionRawRecordSchema = z.object({
  after: z.string().min(1).max(200).nullish(),
})

/** LUM-918: running a pending workspace deletion now needs the name re-typed. */
export const deleteWorkspaceNowSchema = z.object({
  confirmName: z.string().min(1).max(200),
})

/**
 * The core part of PATCH /api/workspaces/me. Plugin-owned settings (LUM-1062)
 * are added by `workspaceSettingsUpdateSchema()` in lib/plugins.
 */
export const updateWorkspaceSchema = createWorkspaceSchema.partial().extend({
  // LUM-859: raw hook-event retention tier in days; `null` = keep forever.
  hookEventRetentionDays: z
    .union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)])
    .nullable()
    .optional(),
  // LUM-933 / LUM-910: session record mode. USED_UP forces
  // hookEventRetentionDays to null (lib/services/workspace.service.ts).
  hookEventRetentionMode: z.enum(['RETAIN', 'USED_UP']).optional(),
  // LUM-912: days a dispositioned crossing keeps its raw text.
  crossingRawRetentionDays: z
    .union([z.literal(7), z.literal(30), z.literal(90)])
    .optional(),
  // LUM-941: days a dead-lettered PR comment sync job keeps its webhook payload.
  deadLetterRetentionDays: z
    .union([z.literal(7), z.literal(30), z.literal(90)])
    .optional(),
  // LUM-917: generate AI-derived content (memories, session / run summaries).
  aiDerivedContentEnabled: z.boolean().optional(),
})

// ─── Project ────────────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name must be at most 200 characters'),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
  isIdea: z.boolean().optional().default(false),
})

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
  isIdea: z.boolean().optional(),
  ownerId: z.string().nullable().optional(),
})

export const reorderProjectsSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, 'orderedIds must contain at least one id')
    .max(500, 'orderedIds is limited to 500 entries'),
})

export const reorderMilestonesSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, 'orderedIds must contain at least one id')
    .max(500, 'orderedIds is limited to 500 entries'),
})

// ─── Tag shared shapes ─────────────────────────────────────────────────────

const tagsIncrementalShape = {
  addTagIds: z.array(z.string().cuid()).max(20).optional(),
  removeTagIds: z.array(z.string().cuid()).max(20).optional(),
} as const

const tagIdsShape = {
  tagIds: z.array(z.string().cuid()).max(20).optional(),
} as const

// ─── Task ───────────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
  status: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
    .optional()
    .default('TODO'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .optional()
    .default('MEDIUM'),
  assigneeActorId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  order: z.number().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  ...tagIdsShape,
})

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
    spec: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
    status: z
      .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
      .optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    assigneeActorId: z.string().nullable().optional(),
    projectId: z.string().optional(),
    order: z.number().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    tagIds: z.array(z.string().cuid()).max(20).optional(),
    sprintId: z.string().nullable().optional(),
    milestoneId: z.string().nullable().optional(),
    claimable: z.boolean().optional(),
    ...tagsIncrementalShape,
  })
  .refine(v => !(v.tagIds && (v.addTagIds || v.removeTagIds)), {
    message: 'tagIds and addTagIds/removeTagIds are mutually exclusive',
    path: ['tagIds'],
  })

/**
 * LUM-959: subtasks were removed. An older CLI still sends `parentRef` for
 * `--parent`; refuse it loudly instead of silently dropping the flag.
 */
const removedParentRef = z
  .never({
    error:
      'Subtasks were removed (LUM-959): --parent is no longer supported. Group related tasks with a milestone, or order them with `lumo task deps add`.',
  })
  .optional()

/**
 * CLI-side task create: accepts human-friendly refs (project name/slug,
 * member email/name) instead of internal IDs. Server resolves them.
 *
 * Priority defaults to LOW to match the CLI's UX default. The web schema
 * (`createTaskSchema`) keeps MEDIUM for other callers — do not unify them.
 */
export const cliCreateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .optional()
    .default('LOW'),
  projectRef: z.string().trim().min(1).max(200).optional(),
  assigneeRef: z.string().trim().min(1).max(200).optional(),
  milestoneRef: z.string().trim().min(1).max(200).optional(),
  reworkOfRef: z.string().trim().min(1).max(200).optional(),
  newScope: z.boolean().optional().default(false),
  // LUM-821: the CLI sends the local-midnight instant of `--due YYYY-MM-DD`
  // (same storage convention as the web DueDatePicker).
  dueDate: z.string().datetime().optional(),
  // LUM-970: pre-fill the description from a task template (system or
  // workspace). Mutually exclusive with `description` — checked in the service.
  templateKey: taskTemplateKeySchema.optional(),
  parentRef: removedParentRef,
  ...tagIdsShape,
})

/**
 * CLI-side task update: accepts human-friendly refs (`assigneeRef`) and
 * partial patches. Every field is optional; `null` on description /
 * assigneeRef means "clear this field." Status / priority use the same
 * upper-case enums as the web schema; the CLI uppercases before sending.
 *
 * Note: there is no at-least-one-field guard here — the route enforces it
 * after parsing so the error message can name the missing flags.
 */
export const cliUpdateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Title cannot be empty')
      .max(500, 'Title must be at most 500 characters')
      .optional(),
    description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
    status: z
      .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
      .optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    assigneeRef: z.string().trim().min(1).max(200).nullable().optional(),
    milestoneRef: z.string().trim().min(1).max(200).nullable().optional(),
    // LUM-646: agent-claimable triage marker. Set by `lumo task update
    // --claimable|--no-claimable` and by `lumo milestone triage` (batch).
    claimable: z.boolean().optional(),
    // LUM-821: null clears. dueDate is an instant (local midnight of the day).
    dueDate: z.string().datetime().nullable().optional(),
    parentRef: removedParentRef,
    ...tagIdsShape,
    ...tagsIncrementalShape,
  })
  .refine(v => !(v.tagIds && (v.addTagIds || v.removeTagIds)), {
    message: 'tagIds and addTagIds/removeTagIds are mutually exclusive',
    path: ['tagIds'],
  })

// ─── AI Description Generation ──────────────────────────────────────────────

export const generateDescriptionSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Title must be at least 3 characters')
      .max(200),
    projectId: z.string().min(1).optional(),
    workspaceUrl: z.string().min(1).optional(),
    existingDescription: z.string().max(10000).optional(),
  })
  .refine(data => data.projectId || data.workspaceUrl, {
    message: 'Either projectId or workspaceUrl is required',
  })

// ─── Members ─────────────────────────────────────────────────────────────────

export const updateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'MEMBER']),
})

// ─── Comments ────────────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
  /** Present when posting a reply; must reference a top-level comment. */
  parentId: z.string().cuid().optional(),
  /** Which specific comment (top-level or sibling reply) is being quoted. */
  quotedCommentId: z.string().cuid().optional(),
})

export const updateCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
})

// ─── Document Comments ────────────────────────────────────────────────────────

// a client- (uuid) or server- (cuid) generated id
const docCommentId = z.string().min(8).max(64)

export const createDocumentCommentSchema = z
  .object({
    /** Client-generated uuid or cuid; matches the data-comment-id written into content. */
    id: docCommentId,
    body: z.string().min(1, 'Comment cannot be empty').max(5000),
    /** Present when posting a reply; references a top-level comment. */
    parentId: docCommentId.optional(),
    /** ProseMirror anchor positions (top-level only). */
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
    /** Snapshot of the selected text (top-level only). */
    quotedText: z.string().max(10000).optional(),
    /**
     * Full document HTML with the new comment mark applied client-side.
     * Required for top-level (anchored) comments; omitted for replies.
     */
    content: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
  })
  .refine(v => v.from === undefined || v.to === undefined || v.to >= v.from, {
    message: 'to must be >= from',
    path: ['to'],
  })

export const updateDocumentCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
})

export const resolveDocumentCommentSchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED']),
})

// ─── Invites ─────────────────────────────────────────────────────────────────

export const sendInvitesSchema = z.object({
  emails: z
    .array(z.string().trim().email('Invalid email address'))
    .min(1, 'At least one email is required')
    .max(10, 'Cannot send more than 10 invites at once'),
  workspaceId: z.string().min(1),
})

// ─── Duplicate Detection ────────────────────────────────────────────────────

export const checkDuplicatesSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  projectId: z.string().min(1, 'Project ID is required'),
})

// ── Documents ─────────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  // Default to empty string so the UI can render a localised "Untitled"
  // placeholder via i18n (en: "Untitled", zh-CN: "无标题", …) instead of
  // showing a hard-coded English literal.
  title: z.string().trim().max(500).optional().default(''),
  emoji: z.string().max(10).nullable().optional(),
  parentId: z.string().cuid().nullable().optional(),
  projectId: z.string().cuid().nullable().optional(),
  // Human-friendly project ref (name or slug, case-insensitive). The route
  // resolves it to a cuid within the caller's workspace. Mirrors
  // cliCreateTaskSchema.projectRef.
  projectRef: z.string().trim().min(1).max(200).optional(),
  workspaceId: z.string().cuid().optional(),
  visibility: z
    .enum(['PRIVATE', 'SHARED', 'WORKSPACE'])
    .optional()
    .default('PRIVATE'),
  contentMarkdown: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
  templateId: z.string().cuid().optional(),
  ...tagIdsShape,
})

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    content: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
    contentMarkdown: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
    emoji: z.string().max(10).nullable().optional(),
    visibility: z.enum(['PRIVATE', 'SHARED', 'WORKSPACE']).optional(),
    projectId: z.string().cuid().nullable().optional(),
    // Human-friendly project ref. `null` clears the project binding (mirrors
    // the CLI's `doc update --project ""` mapping to JSON null).
    projectRef: z.string().trim().min(1).max(200).nullable().optional(),
    sortOrder: z.number().optional(),
    childOrder: z.array(z.string()).optional(),
    publicToken: z.string().max(30).nullable().optional(),
    tags: z.array(z.string().max(30)).max(20).optional(),
    tagIds: z.array(z.string().cuid()).max(20).optional(),
    ...tagsIncrementalShape,
    // Optimistic-concurrency precondition (LUM-409): the contentRevision the
    // caller's edit base was read at. Mismatch → 409.
    ifRevision: z.number().int().nonnegative().optional(),
    // Structure guard override (LUM-410): without it, a markdown body update
    // that drops tables/rows/headings versus the stored body is rejected 422.
    allowShrink: z.boolean().optional(),
  })
  .refine(v => !(v.tagIds && (v.addTagIds || v.removeTagIds)), {
    message: 'tagIds and addTagIds/removeTagIds are mutually exclusive',
    path: ['tagIds'],
  })

/**
 * Section-addressed body edit (LUM-409): replace one heading-addressed
 * section, or append at a section's end (no `section` = document end).
 */
export const editDocumentSectionSchema = z
  .object({
    mode: z.enum(['replace', 'append']),
    section: z.string().trim().min(1).max(500).optional(),
    contentMarkdown: z.string().max(RICH_TEXT_MAX_LENGTH),
    ifRevision: z.number().int().nonnegative().optional(),
    // Structure guard override (LUM-410): a replace that shrinks the
    // addressed section's structure is rejected 422 without it.
    allowShrink: z.boolean().optional(),
  })
  .refine(v => v.mode === 'append' || v.section !== undefined, {
    message: 'section is required when mode is replace',
    path: ['section'],
  })

// Rebuild the markdown source from the stored HTML body (LUM-446). No body
// input — the server serializes the existing content.
export const rebuildDocumentSourceSchema = z.object({
  // Structure guard override (LUM-410): commit even if the rebuilt source
  // re-renders with fewer tables/rows/headings than the stored body.
  allowShrink: z.boolean().optional(),
  // Re-derive even when a source already exists (default: 409 to protect a
  // byte-faithful human source from a serializer-derived downgrade).
  force: z.boolean().optional(),
  ifRevision: z.number().int().nonnegative().optional(),
})

export const createDocumentMentionSchema = z.object({
  taskIdentifier: z
    .string()
    .trim()
    .min(1, 'taskIdentifier is required')
    .max(100),
})

export const moveDocumentSchema = z.object({
  parentId: z.string().cuid().nullable(),
  sortOrder: z.number(),
})

export const createDocumentShareSchema = z.object({
  memberId: z.string().cuid(),
  role: z.enum(['VIEWER', 'EDITOR', 'MANAGER']),
})

export const updateDocumentShareSchema = z.object({
  role: z.enum(['VIEWER', 'EDITOR', 'MANAGER']),
})

// ─── Tags ──────────────────────────────────────────────────────────────────

export const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required').max(30),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be hex format (#rrggbb)')
    .optional(),
})

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
})

// ─── AI Priority Suggestion ────────────────────────────────────────────────

export const suggestPrioritySchema = z.object({
  title: z
    .string()
    .trim()
    .min(4, 'Title must be at least 4 characters')
    .max(500),
  projectId: z.string().min(1).optional(),
  description: z.string().max(10000).optional(),
})

export const priorityOverrideSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  aiSuggested: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  userChosen: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  taskTitle: z.string().min(1).max(500),
  taskDescription: z.string().max(10000).optional(),
})

// ─── Quick Dispatch ─────────────────────────────────────────────────────────

export const quickDispatchSchema = z.object({
  input: z
    .string()
    .trim()
    .min(1, 'Input is required')
    .max(500, 'Input must be at most 500 characters'),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
})

// ─── Quick Dispatch V2 ────────────────────────────────────────────────────

const mentionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task'),
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    position: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('project'),
    id: z.string(),
    name: z.string(),
    position: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('member'),
    actorId: z.string(),
    name: z.string(),
    position: z.tuple([z.number(), z.number()]),
  }),
])

export const quickDispatchV2Schema = z.object({
  input: z
    .string()
    .trim()
    .min(1, 'Input is required')
    .max(1000, 'Input must be at most 1000 characters'),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
  mentions: z.array(mentionSchema).max(20).default([]),
})

// ─── Quick Dispatch Execute ────────────────────────────────────────────────

const executeUpdateActionSchema = z.object({
  type: z.literal('update'),
  taskId: z.string(),
  fields: z.object({
    status: z
      .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
      .optional(),
    assigneeActorId: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  }),
})

const executeCreateActionSchema = z.object({
  type: z.literal('create'),
  title: z.string().trim().min(1).max(500),
  status: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
    .default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  projectId: z.string().min(1, 'Project ID is required'),
  assigneeActorId: z.string().nullable().optional(),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const executeQuickDispatchSchema = z.object({
  actions: z
    .array(
      z.discriminatedUnion('type', [
        executeUpdateActionSchema,
        executeCreateActionSchema,
      ])
    )
    .min(1, 'At least one action is required')
    .max(10, 'Cannot execute more than 10 actions at once'),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
})

// ─── Drafts ────────────────────────────────────────────────────────────────

export const taskDraftDataSchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
  status: z
    .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const projectDraftDataSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
})

export const upsertDraftSchema = z.object({
  id: z.string().cuid().optional(),
  workspaceUrl: z.string().min(1, 'Workspace URL is required'),
  type: z.enum(['TASK', 'PROJECT']),
  data: z.record(z.string(), z.unknown()),
})

// ─── Summaries ────────────────────────────────────────────────────────────────

export const getSummarySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(1),
  before: z.string().datetime().optional(),
})

// ── Pull Request Link ────────────────────────────────────────────────────────

export const linkPullRequestSchema = z
  .object({
    prId: z.string().min(1).optional(),
    url: z.string().url().optional(),
    force: z.boolean().default(false),
  })
  .refine(data => (data.prId ? !data.url : !!data.url), {
    message: 'Provide exactly one of prId or url',
  })

export const searchPullRequestsSchema = z.object({
  q: z.string().min(1).max(100),
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

// ─── Milestones ────────────────────────────────────────────────────────────

export const createMilestoneSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name must be at most 120 characters'),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
})

export const updateMilestoneSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(RICH_TEXT_MAX_LENGTH).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  // LUM-644: advisory token budget — a positive integer within Postgres INT
  // range; null clears it. Never gates anything.
  tokenBudget: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  // LUM-714: milestone completion is derived from task completion — there is
  // no status to patch, so this schema carries no lifecycle field at all. The
  // one human lever over completion is the exit-criteria close override, which
  // has its own endpoint (POST .../close-override).
})

// LUM-714: body of the LUM-643 close-gate override (human/Clerk path only).
export const milestoneCloseOverrideSchema = z.object({
  overrideNote: z.string().trim().min(1).max(2000).optional(),
})

export const listMilestonesQuerySchema = z.object({
  filter: z.enum(['active', 'archived', 'all']).default('active'),
  search: z.string().trim().max(120).optional(),
})

// ─── Workspace Task Filters ────────────────────────────────────────────────

export const workspaceTaskFiltersSchema = z.object({
  projectIds: z.array(z.string()).optional(),
  milestoneIds: z.array(z.string()).optional(),
  statuses: z
    .array(z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']))
    .optional(),
  priorities: z.array(z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])).optional(),
  assigneeActorIds: z.array(z.string()).optional(),
  unassigned: z.boolean().optional(),
  tagIds: z.array(z.string()).optional(),
  sprintIds: z.array(z.string()).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  // LUM-821: `fuzzy` adds typo-tolerant title matching + relevance order to
  // `q`; `exact` (the default, what the web board sends) is substring-only.
  match: z.enum(['exact', 'fuzzy']).optional(),
  // Instant window [dueAfter, dueBefore). Due dates are stored as the
  // author's local midnight, so the caller (who knows its timezone) turns
  // calendar days into instants — the server never guesses a zone.
  dueAfter: z.coerce.date().optional(),
  dueBefore: z.coerce.date().optional(),
})

// ─── Task Dependencies ─────────────────────────────────────────────────────

export const addDependencyBodySchema = z.object({
  /** 对端任务,LUM-N 或 cuid,路由层 resolveTask 解析。 */
  blockedBy: z.string().trim().min(1),
  kind: z.enum(['BLOCKS', 'RELATES']).optional(),
  /**
   * Which side the *current* task is on. BLOCKED_BY (default): current task is
   * blocked by `blockedBy`. BLOCKS: current task blocks `blockedBy`. CLI never
   * sends this, so the default preserves existing CLI behavior.
   */
  direction: z.enum(['BLOCKED_BY', 'BLOCKS']).default('BLOCKED_BY'),
})

export const patchDependencyBodySchema = z.object({
  action: z.enum(['confirm', 'dismiss']),
  reverse: z.boolean().optional(),
})
