import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getContext } from '../context.js'

export function registerProjectTools(server: McpServer) {
  // ─── list_projects ────────────────────────────────────────────────────────

  server.tool(
    'list_projects',
    'List all projects in the workspace.',
    {},
    async () => {
      const { workspaceId } = getContext()

      const projects = await prisma.project.findMany({
        where: { workspaceId },
        select: {
          id: true,
          name: true,
          description: true,
          isIdea: true,
          teamId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { tasks: true } },
        },
        orderBy: { updatedAt: 'desc' },
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ projects }, null, 2),
          },
        ],
      }
    }
  )

  // ─── get_project ─────────────────────────────────────────────────────────

  server.tool(
    'get_project',
    'Get a single project by ID.',
    { projectId: z.string().describe('Project ID') },
    async ({ projectId }) => {
      const { workspaceId } = getContext()

      const project = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
        include: {
          _count: { select: { tasks: true } },
          team: { select: { id: true, name: true, identifier: true } },
        },
      })
      if (!project) throw new Error(`Project ${projectId} not found`)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ project }, null, 2),
          },
        ],
      }
    }
  )

  // ─── create_project ───────────────────────────────────────────────────────

  server.tool(
    'create_project',
    'Create a new project in the workspace.',
    {
      name: z.string().min(1).describe('Project name'),
      description: z.string().optional().describe('Optional description'),
      isIdea: z
        .boolean()
        .optional()
        .default(false)
        .describe('Mark as idea/draft (private)'),
    },
    async ({ name, description, isIdea }) => {
      const { workspaceId, memberId } = getContext()

      // Get default team
      const defaultTeam = await prisma.team.findFirst({
        where: { workspaceId, isDefault: true },
        select: { id: true },
      })
      if (!defaultTeam) throw new Error('No default team found in workspace')

      const project = await prisma.$transaction(async tx => {
        const p = await tx.project.create({
          data: {
            workspaceId,
            teamId: defaultTeam.id,
            createdByMemberId: memberId,
            name,
            description: description ?? null,
            isIdea: isIdea ?? false,
          },
        })

        // Create default Document view
        await tx.view.create({
          data: {
            workspaceId,
            projectId: p.id,
            name: 'Document',
            type: 'DOCUMENT',
            isDefault: true,
          },
        })

        return p
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ project }, null, 2),
          },
        ],
      }
    }
  )

  // ─── update_project ───────────────────────────────────────────────────────

  server.tool(
    'update_project',
    'Update a project name, description, or idea status.',
    {
      projectId: z.string().describe('Project ID'),
      name: z.string().min(1).optional().describe('New name'),
      description: z
        .string()
        .nullable()
        .optional()
        .describe('New description (null to clear)'),
      isIdea: z.boolean().optional().describe('Toggle idea/draft status'),
    },
    async ({ projectId, name, description, isIdea }) => {
      const { workspaceId } = getContext()

      const existing = await prisma.project.findFirst({
        where: { id: projectId, workspaceId },
      })
      if (!existing) throw new Error(`Project ${projectId} not found`)

      const data: Record<string, unknown> = {}
      if (name !== undefined) data.name = name
      if (description !== undefined) data.description = description
      if (isIdea !== undefined) data.isIdea = isIdea

      const project = await prisma.project.update({
        where: { id: projectId },
        data,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ project }, null, 2),
          },
        ],
      }
    }
  )
}
