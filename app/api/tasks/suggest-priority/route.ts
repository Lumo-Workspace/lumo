import { GENERATION_MODEL } from '@/lib/ai/models'
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { suggestPrioritySchema } from '@/lib/validation/schemas'
import {
  PRIORITY_SYSTEM_PROMPT,
  PrioritySuggestionSchema,
  buildPriorityPrompt,
} from '@/lib/prompts/priority'
import { taskRepository, miscRepository } from '@/lib/repositories'

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

    let projectName: string | undefined
    let historicalTasks: {
      id: string
      number: number
      title: string
      priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    }[] = []
    let overrides: {
      taskTitle: string
      aiSuggested: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
      userChosen: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    }[] = []

    if (projectId) {
      const projectResult = await loadProjectAndMember(projectId, userId)
      if (projectResult instanceof NextResponse) return projectResult
      const { project } = projectResult

      projectName = project.name

      historicalTasks = await taskRepository.findHistoricalByProject(
        projectId,
        50
      )

      overrides = await miscRepository.findPriorityOverrides(
        userId,
        projectId,
        30
      )
    }

    const prompt = buildPriorityPrompt({
      title,
      ...(description ? { description } : {}),
      projectName,
      historicalTasks,
      overrides,
    })

    const { object } = await generateObject({
      model: gateway(GENERATION_MODEL),
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
