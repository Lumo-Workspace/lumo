import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { priorityOverrideSchema } from '@/lib/validation/schemas'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = priorityOverrideSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const {
      taskId,
      projectId,
      aiSuggested,
      userChosen,
      taskTitle,
      taskDescription,
    } = parsed.data

    await prisma.priorityOverride.create({
      data: {
        taskId,
        memberId: userId,
        projectId,
        aiSuggested,
        userChosen,
        taskTitle,
        taskDescription: taskDescription ?? null,
      },
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    console.error('POST /api/tasks/priority-override error:', error)
    return NextResponse.json(
      { error: 'Failed to record priority override' },
      { status: 500 }
    )
  }
}
