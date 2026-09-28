import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import {
  isPrismaUniqueError,
  loadProjectAndMember,
  zodError,
} from '@/lib/api/helpers'
import { projectRepository } from '@/lib/repositories'
import { projectRepositoryService } from '@/lib/services/project-repository.service'

type Params = { params: Promise<{ id: string }> }

const addRepoSchema = z.object({
  fullName: z
    .string()
    .min(1)
    .regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  isDefault: z.boolean().optional(),
})

/**
 * GET /api/projects/[id]/repositories — list all linked repos for a project
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result

    const repositories = await projectRepository.findRepositories(id)

    return NextResponse.json({ repositories })
  } catch (error) {
    console.error('GET /api/projects/[id]/repositories error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects/[id]/repositories — add a repo to the project
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const result = await loadProjectAndMember(id, userId)
    if (result instanceof NextResponse) return result

    const body = await req.json()
    const parsed = addRepoSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { fullName, isDefault } = parsed.data
    const repository = await projectRepositoryService.addRepository({
      projectId: id,
      workspaceId: result.project.workspaceId,
      fullName,
      isDefault,
    })

    return NextResponse.json({ repository }, { status: 201 })
  } catch (error: unknown) {
    // LUM-883: not a confirmed repository (403) / App not installed (400)
    const status = (error as { status?: unknown }).status
    if (status === 403 || status === 400) {
      return NextResponse.json(
        {
          error: (error as Error).message,
          code: (error as { code?: string }).code,
        },
        { status }
      )
    }
    // Unique constraint: repo already linked to project
    if (isPrismaUniqueError(error)) {
      return NextResponse.json(
        { error: 'This repository is already linked to the project' },
        { status: 409 }
      )
    }
    console.error('POST /api/projects/[id]/repositories error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
