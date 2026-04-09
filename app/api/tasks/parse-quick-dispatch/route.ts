import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { quickDispatchV2Schema } from '@/lib/validation/schemas'
import { quickDispatchService } from '@/lib/services/quick-dispatch.service'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = quickDispatchV2Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { input, workspaceUrl, mentions } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    const result = await quickDispatchService.parseWithAI(
      input,
      workspaceId,
      userId,
      mentions
    )

    return NextResponse.json(result)
  } catch (error) {
    const err = error as Error & { status?: number }
    if (err.status === 404) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('POST /api/tasks/parse-quick-dispatch error:', error)
    return NextResponse.json(
      { error: 'Failed to parse task input' },
      { status: 500 }
    )
  }
}
