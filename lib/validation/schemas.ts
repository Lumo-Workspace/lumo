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
  defaultReviewerId: z.string().nullable().optional(),
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
  assigneeId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  order: z.number().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().nullable().optional(),
  reviewerId: z.string().nullable().optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  order: z.number().optional(),
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
