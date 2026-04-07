import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { suggestPrioritySchema } from '@/lib/validation/schemas'
import {
  PRIORITY_SYSTEM_PROMPT,
  PrioritySuggestionSchema,
  buildPriorityPrompt,
} from '@/lib/prompts/priority'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = suggestPrioritySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { title, projectId, description } = parsed.data

    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult
    const { project } = projectResult

    const historicalTasks = await prisma.task.findMany({
      where: { projectId },
      select: { id: true, number: true, title: true, priority: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const overrides = await prisma.priorityOverride.findMany({
      where: { memberId: userId, projectId },
      select: { taskTitle: true, aiSuggested: true, userChosen: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })

    const prompt = buildPriorityPrompt({
      title,
      ...(description ? { description } : {}),
      projectName: project.name,
      historicalTasks,
      overrides,
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: PrioritySuggestionSchema,
      system: PRIORITY_SYSTEM_PROMPT,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('POST /api/tasks/suggest-priority error:', error)
    return NextResponse.json(
      { error: 'Failed to generate priority suggestion' },
      { status: 500 }
    )
  }
}
