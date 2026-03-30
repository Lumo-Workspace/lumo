import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import {
  isPrismaUniqueError,
  loadProjectAndMember,
  zodError,
} from '@/lib/api/helpers'

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
    if (result instanceof NextResponse) return result

    const body = await req.json()
    const parsed = addRepoSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

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
