import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import { patchMemoryBodySchema } from '@/lib/validation/memory'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { zodError } from '@/lib/api/helpers'
import type { MemoryContent } from '@/lib/memory/schemas'

export const runtime = 'nodejs'

type Params = { params: Promise<{ memoryId: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { memoryId } = await params

    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const raw = await request.json()
    const parsed = patchMemoryBodySchema.safeParse(raw)
    if (!parsed.success) return zodError(parsed)

    let content: MemoryContent | undefined
    if (parsed.data.content !== undefined) {
      try {
        content = parseMemoryContent(existing.category, parsed.data.content)
      } catch {
        return NextResponse.json({ error: 'Content does not match the category schema' }, { status: 400 })
      }
    }

    let memory
    if (parsed.data.scope === 'PROJECT') {
      memory = await memoryManagementService.promoteToProject(memoryId, content)
    } else {
      memory = await memoryManagementService.editContent(memoryId, content as MemoryContent)
    }
    return NextResponse.json({ memory }, { status: 200 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json({ error: error.message }, { status: (error as Error & { status: number }).status })
    }
    console.error('PATCH /api/memories/[memoryId] error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { memoryId } = await params

    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await memoryManagementService.delete(memoryId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json({ error: error.message }, { status: (error as Error & { status: number }).status })
    }
    console.error('DELETE /api/memories/[memoryId] error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
