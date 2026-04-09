import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { projectRepository } from '@/lib/repositories'

type Params = { params: Promise<{ id: string; repoId: string }> }

const patchRepoSchema = z.object({
  isDefault: z.boolean().optional(),
})

async function loadRepoAndMember(
  projectId: string,
  repoId: string,
  userId: string
) {
  const repo = await projectRepository.findRepositoryById(repoId)
  if (!repo || repo.projectId !== projectId) return null
  const member = await requireWorkspaceMember(repo.project.workspaceId, userId)
  if (member instanceof NextResponse) return null
  return { repo, member }
}

/**
 * PATCH /api/projects/[id]/repositories/[repoId] — set as default
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, repoId } = await params

    const result = await loadRepoAndMember(id, repoId, userId)
    if (!result) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      )
    }

    const body = await req.json()
    const parsed = patchRepoSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    if (parsed.data.isDefault === true) {
      // Clear existing defaults, then set this one
      await projectRepository.clearDefaultRepositories(id)
    }

    const updateData: { isDefault?: boolean } = {}
    if (parsed.data.isDefault !== undefined)
      updateData.isDefault = parsed.data.isDefault

    const updated = await projectRepository.updateRepository(repoId, updateData)

    return NextResponse.json({ repository: updated })
  } catch (error) {
    console.error(
      'PATCH /api/projects/[id]/repositories/[repoId] error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/projects/[id]/repositories/[repoId] — unlink repo from project
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id, repoId } = await params

    const result = await loadRepoAndMember(id, repoId, userId)
    if (!result) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      )
    }

    await projectRepository.deleteRepository(repoId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(
      'DELETE /api/projects/[id]/repositories/[repoId] error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
