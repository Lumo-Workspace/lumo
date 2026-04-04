import { NextResponse } from 'next/server'

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { generateDescriptionSchema } from '@/lib/validation/schemas'

const descriptionResponseSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
})

function buildPrompt({
  title,
  projectName,
  projectDescription,
  recentTasks,
  existingDescription,
}: {
  title: string
  projectName: string
  projectDescription: string | null
  recentTasks: { title: string; description: string | null }[]
  existingDescription?: string
}): string {
  const projectContext = projectDescription
    ? `Project: ${projectName}\nProject description: ${projectDescription}`
    : `Project: ${projectName}`

  const recentTasksContext =
    recentTasks.length > 0
      ? `\nRecent tasks in this project for style reference:\n${recentTasks
          .map(t => `- ${t.title}${t.description ? `: ${t.description}` : ''}`)
          .join('\n')}`
      : ''

  if (existingDescription) {
    return `You are a project management assistant. Improve the following task description — make it more actionable, specific, and well-structured.

${projectContext}${recentTasksContext}

Task title: ${title}
Current description: ${existingDescription}

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">. Preserve the original intent but make it clearer and more actionable.`
  }

  return `You are a project management assistant. Generate a concise task description (1–2 sentences of execution instructions) for the following task.

${projectContext}${recentTasksContext}

Task title: ${title}

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li> (for steps), <input type="checkbox"> (for checklists). Keep it actionable and concise — focus on HOW to execute, not WHAT the task is (the title already says that).`
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = generateDescriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { title, projectId, existingDescription } = parsed.data

    // Fetch project + verify membership (also serves as authorization)
    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult
    const { project } = projectResult

    // Fetch recent tasks for context
    const recentTasks = await prisma.task.findMany({
      where: { projectId },
      select: { title: true, description: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    const prompt = buildPrompt({
      title,
      projectName: project.name,
      projectDescription: project.description ?? null,
      recentTasks,
      ...(existingDescription !== undefined ? { existingDescription } : {}),
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: descriptionResponseSchema,
      prompt,
    })

    if (!object.description) {
      return NextResponse.json(
        { error: 'Failed to generate description' },
        { status: 500 }
      )
    }

    return NextResponse.json({ description: object.description })
  } catch (error) {
    console.error('POST /api/tasks/generate-description error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}
