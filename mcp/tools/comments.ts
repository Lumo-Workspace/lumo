import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getContext } from '../context.js'
import { resolveTaskId } from '../resolvers.js'

export function registerCommentTools(server: McpServer) {
  // ─── list_comments ────────────────────────────────────────────────────────

  server.registerTool(
    'list_comments',
    {
      description: 'List all comments on a task.',
      inputSchema: {
        taskId: z
          .string()
          .describe('Task ID (cuid) or identifier like "ENG-12"'),
      },
    },
    async ({ taskId }) => {
      const { workspaceId } = getContext()
      const id = await resolveTaskId(taskId, workspaceId)

      const task = await prisma.task.findFirst({
        where: { id, team: { workspaceId } },
      })
      if (!task) throw new Error(`Task ${taskId} not found`)

      const comments = await prisma.comment.findMany({
        where: { taskId: id },
        orderBy: { createdAt: 'asc' },
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ comments }, null, 2),
          },
        ],
      }
    }
  )

  // ─── manage_comment ───────────────────────────────────────────────────────

  server.registerTool(
    'manage_comment',
    {
      description:
        'Create, update, or delete a comment. Use action="create" | "update" | "delete".',
      inputSchema: {
        action: z
          .enum(['create', 'update', 'delete'])
          .describe('Operation to perform'),
        taskId: z
          .string()
          .optional()
          .describe('Task ID or identifier — required for action="create"'),
        commentId: z
          .string()
          .optional()
          .describe(
            'Comment ID — required for action="update" or action="delete"'
          ),
        body: z
          .string()
          .optional()
          .describe('Comment text — required for action="create" or "update"'),
      },
    },
    async ({ action, taskId, commentId, body }) => {
      const { workspaceId, memberId } = getContext()

      if (action === 'create') {
        if (!taskId) throw new Error('taskId is required for action="create"')
        if (!body) throw new Error('body is required for action="create"')

        const id = await resolveTaskId(taskId, workspaceId)
        const task = await prisma.task.findFirst({
          where: { id, team: { workspaceId } },
          select: { id: true },
        })
        if (!task) throw new Error(`Task ${taskId} not found`)

        const actor = await prisma.actor.findUnique({
          where: { memberId },
          select: { id: true },
        })
        if (!actor) throw new Error('Actor not found for current member')

        const comment = await prisma.comment.create({
          data: { taskId: id, authorActorId: actor.id, body },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ comment }, null, 2),
            },
          ],
        }
      }

      if (action === 'update') {
        if (!commentId)
          throw new Error('commentId is required for action="update"')
        if (!body) throw new Error('body is required for action="update"')

        const existing = await prisma.comment.findUnique({
          where: { id: commentId },
          include: { task: { include: { team: true } } },
        })
        if (!existing || existing.task.team.workspaceId !== workspaceId) {
          throw new Error(`Comment ${commentId} not found`)
        }

        const comment = await prisma.comment.update({
          where: { id: commentId },
          data: { body },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ comment }, null, 2),
            },
          ],
        }
      }

      // action === 'delete'
      if (!commentId)
        throw new Error('commentId is required for action="delete"')

      const existing = await prisma.comment.findUnique({
        where: { id: commentId },
        include: { task: { include: { team: true } } },
      })
      if (!existing || existing.task.team.workspaceId !== workspaceId) {
        throw new Error(`Comment ${commentId} not found`)
      }

      await prisma.comment.delete({ where: { id: commentId } })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { success: true, deletedId: commentId },
              null,
              2
            ),
          },
        ],
      }
    }
  )
}
