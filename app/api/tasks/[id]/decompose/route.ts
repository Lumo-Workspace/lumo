import { GENERATION_MODEL } from '@/lib/ai/models'
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories'

const subtasksSchema = z.object({
  subtasks: z
    .array(z.object({ title: z.string() }))
    .min(2)
    .max(4),
})

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult
  const { id } = await params

  const task = await taskRepository.findForDecompose(id)

  const memberResult = await requireTaskMember(task, userId)
  if (memberResult instanceof NextResponse) return memberResult

  const { task: verifiedTask } = memberResult

  const prompt = `You are a project management assistant. Given a task, break it down into 2-4 specific, actionable subtasks.

Task title: ${verifiedTask.title}
${verifiedTask.description ? `Task description: ${verifiedTask.description}` : ''}

Rules:
- Return 2-4 subtasks
- Each subtask title should be concise (under 100 characters)
- Subtasks should be specific and actionable
- Together they should cover the full scope of the parent task
- Do not include generic tasks like "testing" or "code review" unless the parent task is specifically about those`

  try {
    const { object } = await generateObject({
      model: gateway(GENERATION_MODEL),
      schema: subtasksSchema,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('[decompose] AI generation failed:', error)
    return NextResponse.json(
      { error: 'Failed to generate subtasks' },
      { status: 500 }
    )
  }
}
