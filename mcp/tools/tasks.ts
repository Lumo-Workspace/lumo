import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getContext, resolveAssigneeActor } from '../context.js'
import { resolveTaskId } from '../resolvers.js'
import { trashTask } from '../trash.js'

const statusEnum = z
  .enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'])
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
  assigneeActorId: true,
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
  assigneeActorId: string | null
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

  server.registerTool(
    'list_tasks',
    {
      description:
        'List tasks. Filter by project, status, priority, or assignee.',
      inputSchema: {
        projectId: z.string().optional().describe('Filter by project ID'),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        assigneeId: z
          .string()
          .optional()
          .describe('Filter by assignee member ID. Use "me" for yourself.'),
      },
    },
    async ({ projectId, status, priority, assigneeId }) => {
      const { workspaceId, memberId } = getContext()
      const resolvedAssigneeActorId = await resolveAssigneeActor(
        assigneeId,
        memberId
      )

      const tasks = await prisma.task.findMany({
        where: {
          team: { workspaceId },
          ...(projectId ? { projectId } : {}),
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(resolvedAssigneeActorId
            ? { assigneeActorId: resolvedAssigneeActorId }
            : {}),
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

  server.registerTool(
    'get_task',
    {
      description: 'Get a single task by ID or identifier (e.g. "LUM-7").',
      inputSchema: {
        taskId: z
          .string()
          .describe('Task ID (cuid) or identifier like "ENG-12"'),
      },
    },
    async ({ taskId }) => {
      const { workspaceId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      const task = await prisma.task.findUnique({
        where: { id },
        select: {
          ...taskSelect,
          comments: {
            select: {
              id: true,
              authorActorId: true,
              body: true,
              createdAt: true,
            },
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

  server.registerTool(
    'create_task',
    {
      description: 'Create a new task in a project.',
      inputSchema: {
        projectId: z.string().describe('Project ID'),
        title: z.string().min(1).describe('Task title'),
        description: z.string().optional().describe('Task description'),
        status: statusEnum.optional().default('TODO'),
        priority: priorityEnum.optional().default('MEDIUM'),
        assigneeId: z
          .string()
          .optional()
          .describe('Assignee member ID. Use "me" for yourself.'),
      },
    },
    async ({ projectId, title, description, status, priority, assigneeId }) => {
      const { workspaceId, memberId } = getContext()
      const resolvedAssigneeActorId = await resolveAssigneeActor(
        assigneeId,
        memberId
      )

      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
      })
      if (!project) throw new Error(`Project ${projectId} not found`)

      const maxOrderTask = await prisma.task.findFirst({
        where: { projectId },
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
            // LUM-992: denormalized from the (workspace-checked) project.
            workspaceId: project.workspaceId,
            teamId: project.teamId,
            number: taskSeq,
            title,
            description: description ?? null,
            status: status ?? 'TODO',
            priority: priority ?? 'MEDIUM',
            assigneeActorId: resolvedAssigneeActorId ?? null,
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

  server.registerTool(
    'update_task',
    {
      description:
        'Update task fields: title, description, status, priority, or assignee.',
      inputSchema: {
        taskId: z
          .string()
          .describe('Task ID (cuid) or identifier like "ENG-12"'),
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
    },
    async ({ taskId, title, description, status, priority, assigneeId }) => {
      const { workspaceId, memberId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

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
        data.assigneeActorId =
          assigneeId === null
            ? null
            : ((await resolveAssigneeActor(assigneeId, memberId)) ?? null)
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

  server.registerTool(
    'delete_task',
    {
      description:
        'Move a task to the trash (restorable for 30 days from Settings → Trash).',
      inputSchema: {
        taskId: z
          .string()
          .describe('Task ID (cuid) or identifier like "ENG-12"'),
      },
    },
    async ({ taskId }) => {
      const { workspaceId, memberId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      const existing = await prisma.task.findFirst({
        where: { id, team: { workspaceId } },
      })
      if (!existing) throw new Error(`Task ${taskId} not found`)

      const member = await prisma.workspaceMember.findUnique({
        where: { id: memberId },
        select: { clerkId: true },
      })
      await trashTask(prisma, id, member?.clerkId ?? null)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, trashedId: id }, null, 2),
          },
        ],
      }
    }
  )

  // ─── move_task ────────────────────────────────────────────────────────────

  server.registerTool(
    'move_task',
    {
      description: 'Move a task to a different project.',
      inputSchema: {
        taskId: z
          .string()
          .describe('Task ID (cuid) or identifier like "ENG-12"'),
        projectId: z
          .string()
          .optional()
          .describe('Target project ID to move the task to'),
      },
    },
    async ({ taskId, projectId }) => {
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
