import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, requireWorkspaceByUrl } from '@/lib/api/helpers'
import { generateDescriptionSchema } from '@/lib/validation/schemas'
import { aiFeaturesService, descriptionService } from '@/lib/services'

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

    const { title, projectId, workspaceUrl, existingDescription } = parsed.data

    // ── With project: generate description with project context ──────────
    if (projectId) {
      const projectResult = await loadProjectAndMember(projectId, userId)
      if (projectResult instanceof NextResponse) return projectResult
      const { project } = projectResult
      await aiFeaturesService.assertEnabled({ projectId }, 'taskDescription')

      const result = await descriptionService.generateWithProject(
        title,
        projectId,
        { name: project.name, description: project.description ?? null },
        existingDescription
      )
      return NextResponse.json(result)
    }

    // ── Without project: generate description + suggest project ──────────
    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl ?? null)
    if (wsResult instanceof NextResponse) return wsResult
    await aiFeaturesService.assertEnabled(
      { workspaceId: wsResult.workspace.id },
      'taskDescription'
    )

    const result = await descriptionService.generateWithoutProject(
      title,
      wsResult.workspace.id,
      existingDescription
    )
    return NextResponse.json(result)
  } catch (error) {
    const { status = 500, code } = error as { status?: number; code?: string }
    const message =
      error instanceof Error ? error.message : 'Failed to generate description'
    return NextResponse.json(
      { error: message, ...(code && { code }) },
      { status }
    )
  }
}
