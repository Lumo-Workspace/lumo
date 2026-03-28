import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

const addRepoSchema = z.object({
  fullName: z
    .string()
    .min(1)
    .regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  isDefault: z.boolean().optional(),
})

async function loadProjectAndMember(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) return null
  const member = await requireWorkspaceMember(project.workspaceId, userId)
  if (member instanceof NextResponse) return null
  return { project, member }
}

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
    if (!result) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const repositories = await prisma.projectRepository.findMany({
      where: { projectId: id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    })

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
    if (!result) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = addRepoSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { fullName, isDefault } = parsed.data
    const name = fullName.split('/')[1] ?? fullName

    // If this is being set as default, clear existing defaults first
    if (isDefault) {
      await prisma.projectRepository.updateMany({
        where: { projectId: id, isDefault: true },
        data: { isDefault: false },
      })
    }

    // If no repos exist yet, make first one default automatically
    const existingCount = await prisma.projectRepository.count({
      where: { projectId: id },
    })

    const repository = await prisma.projectRepository.create({
      data: {
        projectId: id,
        fullName,
        name,
        isDefault: isDefault ?? existingCount === 0,
      },
    })

    return NextResponse.json({ repository }, { status: 201 })
  } catch (error: unknown) {
    // Unique constraint: repo already linked to project
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
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
