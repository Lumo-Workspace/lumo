import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getContext, resolveAssignee } from '../context.js'
import { resolveTaskId } from '../resolvers.js'

const statusEnum = z
  .enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
  .describe('Task status')

const priorityEnum = z
  .enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  .describe('Task priority')

const taskSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  order: true,
  projectId: true,
  assigneeId: true,
  parentTaskId: true,
  createdAt: true,
  updatedAt: true,
  team: { select: { identifier: true } },
  project: { select: { id: true, name: true } },
} as const

function formatTask(t: {
  id: string
  number: number
  title: string
  description: string | null
  status: string
  priority: string
  order: number
  projectId: string
  assigneeId: string | null
  parentTaskId: string | null
  createdAt: Date
  updatedAt: Date
  team: { identifier: string }
  project: { id: string; name: string }
}) {
  return {
    ...t,
    identifier: `${t.team.identifier}-${t.number}`,
    teamIdentifier: t.team.identifier,
  }
}

export function registerTaskTools(server: McpServer) {
  // ─── list_tasks ───────────────────────────────────────────────────────────

  server.tool(
    'list_tasks',
    'List tasks. Filter by project, status, priority, or assignee.',
    {
      projectId: z.string().optional().describe('Filter by project ID'),
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      assigneeId: z
        .string()
        .optional()
        .describe('Filter by assignee member ID. Use "me" for yourself.'),
      includeSubtasks: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include subtasks (default true)'),
    },
    async ({ projectId, status, priority, assigneeId, includeSubtasks }) => {
      const { workspaceId, memberId } = getContext()
      const resolvedAssigneeId = resolveAssignee(assigneeId, memberId)

      // Build where clause scoped to workspace via team
      const tasks = await prisma.task.findMany({
        where: {
          team: { workspaceId },
          ...(projectId ? { projectId } : {}),
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(resolvedAssigneeId ? { assigneeId: resolvedAssigneeId } : {}),
          ...(!includeSubtasks ? { parentTaskId: null } : {}),
        },
        select: taskSelect,
        orderBy: [{ status: 'asc' }, { order: 'asc' }],
        take: 200,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ tasks: tasks.map(formatTask) }, null, 2),
          },
        ],
      }
    }
  )

  // ─── get_task ─────────────────────────────────────────────────────────────

  server.tool(
    'get_task',
    'Get a single task by ID or identifier (e.g. "LUM-7").',
    {
      taskId: z.string().describe('Task ID (cuid) or identifier like "ENG-12"'),
    },
    async ({ taskId }) => {
      const { workspaceId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      const task = await prisma.task.findUnique({
        where: { id },
        select: {
          ...taskSelect,
          children: { select: taskSelect },
          comments: {
            select: { id: true, authorId: true, body: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      if (!task) throw new Error(`Task ${taskId} not found`)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ task: formatTask(task) }, null, 2),
          },
        ],
      }
    }
  )

  // ─── create_task ──────────────────────────────────────────────────────────

  server.tool(
    'create_task',
    'Create a new task in a project.',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Task description'),
      status: statusEnum.optional().default('TODO'),
      priority: priorityEnum.optional().default('MEDIUM'),
      assigneeId: z
        .string()
        .optional()
        .describe('Assignee member ID. Use "me" for yourself.'),
      parentTaskId: z
        .string()
        .optional()
        .describe('Parent task ID or identifier for subtasks'),
    },
    async ({
      projectId,
      title,
      description,
      status,
      priority,
      assigneeId,
      parentTaskId,
    }) => {
      const { workspaceId, memberId } = getContext()
      const resolvedAssigneeId = resolveAssignee(assigneeId, memberId)

      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
      })
      if (!project) throw new Error(`Project ${projectId} not found`)

      // Resolve parentTaskId
      let resolvedParentId: string | null = null
      if (parentTaskId) {
        resolvedParentId = await resolveTaskId(parentTaskId, workspaceId)
      }

      // Calculate order: append at end
      const maxOrderTask = await prisma.task.findFirst({
        where: {
          projectId,
          parentTaskId: resolvedParentId,
        },
        orderBy: { order: 'desc' },
        select: { order: true },
      })
      const order = (maxOrderTask?.order ?? 0) + 1

      const task = await prisma.$transaction(async tx => {
        const { taskSeq } = await tx.team.update({
          where: { id: project.teamId },
          data: { taskSeq: { increment: 1 } },
          select: { taskSeq: true },
        })

        return tx.task.create({
          data: {
            projectId,
            teamId: project.teamId,
            number: taskSeq,
            title,
            description: description ?? null,
            status: status ?? 'TODO',
            priority: priority ?? 'MEDIUM',
            assigneeId: resolvedAssigneeId ?? null,
            parentTaskId: resolvedParentId,
            order,
          },
          select: taskSelect,
        })
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ task: formatTask(task) }, null, 2),
          },
        ],
      }
    }
  )

  // ─── update_task ──────────────────────────────────────────────────────────

  server.tool(
    'update_task',
    'Update task fields: title, description, status, priority, or assignee.',
    {
      taskId: z.string().describe('Task ID (cuid) or identifier like "ENG-12"'),
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      status: statusEnum.optional(),
      priority: priorityEnum.optional(),
      assigneeId: z
        .string()
        .nullable()
        .optional()
        .describe('New assignee member ID, "me", or null to unassign'),
    },
    async ({ taskId, title, description, status, priority, assigneeId }) => {
      const { workspaceId, memberId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      // Verify task belongs to this workspace
      const existing = await prisma.task.findFirst({
        where: { id, team: { workspaceId } },
      })
      if (!existing) throw new Error(`Task ${taskId} not found`)

      const data: Record<string, unknown> = {}
      if (title !== undefined) data.title = title
      if (description !== undefined) data.description = description
      if (status !== undefined) data.status = status
      if (priority !== undefined) data.priority = priority
      if (assigneeId !== undefined) {
        data.assigneeId =
          assigneeId === null ? null : resolveAssignee(assigneeId, memberId)
      }

      const task = await prisma.task.update({
        where: { id },
        data,
        select: taskSelect,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ task: formatTask(task) }, null, 2),
          },
        ],
      }
    }
  )

  // ─── delete_task ──────────────────────────────────────────────────────────

  server.tool(
    'delete_task',
    'Delete a task. Subtasks will have their parent cleared.',
    {
      taskId: z.string().describe('Task ID (cuid) or identifier like "ENG-12"'),
    },
    async ({ taskId }) => {
      const { workspaceId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      const existing = await prisma.task.findFirst({
        where: { id, team: { workspaceId } },
      })
      if (!existing) throw new Error(`Task ${taskId} not found`)

      await prisma.task.delete({ where: { id } })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, deletedId: id }, null, 2),
          },
        ],
      }
    }
  )

  // ─── move_task ────────────────────────────────────────────────────────────

  server.tool(
    'move_task',
    'Move a task to a different project or change its parent.',
    {
      taskId: z.string().describe('Task ID (cuid) or identifier like "ENG-12"'),
      projectId: z
        .string()
        .optional()
        .describe('Target project ID to move the task to'),
      parentTaskId: z
        .string()
        .nullable()
        .optional()
        .describe(
          'New parent task ID/identifier, or null to make it a root task'
        ),
    },
    async ({ taskId, projectId, parentTaskId }) => {
      const { workspaceId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      const existing = await prisma.task.findFirst({
        where: { id, team: { workspaceId } },
        include: { project: true },
      })
      if (!existing) throw new Error(`Task ${taskId} not found`)

      const data: Record<string, unknown> = {}

      if (projectId !== undefined) {
        const newProject = await prisma.project.findFirst({
          where: { id: projectId, workspaceId },
        })
        if (!newProject) throw new Error(`Project ${projectId} not found`)
        data.projectId = projectId
      }

      if (parentTaskId !== undefined) {
        if (parentTaskId === null) {
          data.parentTaskId = null
        } else {
          const resolvedParentId = await resolveTaskId(
            parentTaskId,
            workspaceId
          )
          if (resolvedParentId === id) {
            throw new Error('A task cannot be its own parent')
          }
          data.parentTaskId = resolvedParentId
        }
      }

      const task = await prisma.task.update({
        where: { id },
        data,
        select: taskSelect,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ task: formatTask(task) }, null, 2),
          },
        ],
      }
    }
  )
}
