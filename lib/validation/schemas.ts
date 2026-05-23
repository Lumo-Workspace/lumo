import { z } from 'zod'

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

export const updateWorkspaceSchema = createWorkspaceSchema.partial().extend({
  riskOverdueRatio: z.number().min(0).max(1).optional(),
  riskStalledDays: z.number().int().min(1).max(30).optional(),
  riskStalledMinCount: z.number().int().min(1).max(50).optional(),
  riskAgentFailRatio: z.number().min(0).max(1).optional(),
  riskStalePrDays: z.number().int().min(1).max(30).optional(),
  riskThroughputDrop: z.number().min(0).max(1).optional(),
})

// ─── Project ────────────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name must be at most 200 characters'),
  description: z.string().max(2000).optional(),
  isIdea: z.boolean().optional().default(false),
})

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isIdea: z.boolean().optional(),
  ownerId: z.string().nullable().optional(),
  riskOverdueRatio: z.number().min(0).max(1).nullable().optional(),
  riskStalledDays: z.number().int().min(1).max(30).nullable().optional(),
  riskStalledMinCount: z.number().int().min(1).max(50).nullable().optional(),
  riskAgentFailRatio: z.number().min(0).max(1).nullable().optional(),
  riskStalePrDays: z.number().int().min(1).max(30).nullable().optional(),
  riskThroughputDrop: z.number().min(0).max(1).nullable().optional(),
})

export const reorderProjectsSchema = z.object({
  orderedIds: z
    .array(z.string().cuid())
    .min(1, 'orderedIds must contain at least one id')
    .max(500, 'orderedIds is limited to 500 entries'),
})

// ─── Task ───────────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(500, 'Title must be at most 500 characters'),
  description: z.string().max(10000).nullable().optional(),
  status: z
    .enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
    .optional()
    .default('TODO'),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .optional()
    .default('MEDIUM'),
  assigneeActorId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  repositoryId: z.string().nullable().optional(),
  sprintId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  order: z.number().optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  spec: z.string().max(20000).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeActorId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  repositoryId: z.string().nullable().optional(),
  order: z.number().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tagIds: z.array(z.string().cuid()).max(20).optional(),
  sprintId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
})

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
  description: z.string().max(10000).nullable().optional(),
  priority: z
    .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    .optional()
    .default('LOW'),
  projectRef: z.string().trim().min(1).max(200).optional(),
  assigneeRef: z.string().trim().min(1).max(200).optional(),
  milestoneRef: z.string().trim().min(1).max(200).optional(),
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
export const cliUpdateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title cannot be empty')
    .max(500, 'Title must be at most 500 characters')
    .optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeRef: z.string().trim().min(1).max(200).nullable().optional(),
  milestoneRef: z.string().trim().min(1).max(200).nullable().optional(),
})

// ─── Batch Task Creation ───────────────────────────────────────────────────

export const batchCreateTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z
          .string()
          .trim()
          .min(1, 'Title is required')
          .max(500, 'Title must be at most 500 characters'),
        status: z
          .enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
          .optional()
          .default('TODO'),
        priority: z
          .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
          .optional()
          .default('MEDIUM'),
        assigneeActorId: z.string().nullable().optional(),
        parentTaskId: z.string(),
      })
    )
    .min(1, 'At least one task is required')
    .max(10, 'Cannot create more than 10 tasks at once'),
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
  contentMarkdown: z.string().max(500000).optional(),
})

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  content: z.string().max(500000).nullable().optional(),
  contentMarkdown: z.string().max(500000).optional(),
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
    status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
    assigneeActorId: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  }),
})

const executeCreateActionSchema = z.object({
  type: z.literal('create'),
  title: z.string().trim().min(1).max(500),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).default('TODO'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  projectId: z.string().min(1, 'Project ID is required'),
  assigneeActorId: z.string().nullable().optional(),
  description: z.string().max(10000).optional(),
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
  description: z.string().max(10000).optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  repositoryId: z.string().optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const projectDraftDataSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
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
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date().optional(),
  targetDate: z.coerce.date().optional(),
})

export const updateMilestoneSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  startDate: z.coerce.date().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
})
