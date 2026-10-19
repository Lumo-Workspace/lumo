import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import {
  getMemoryByIdForWorkspace,
  resolveMemoryRef,
} from '@/lib/services/memory/memory-read.service'
import { patchMemoryBodySchema } from '@/lib/validation/memory'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { zodError } from '@/lib/api/helpers'
import type { MemoryContent } from '@/lib/memory/schemas'

export const runtime = 'nodejs'

type Params = { params: Promise<{ memoryId: string }> }

/**
 * GET /api/memories/[memoryId]
 * `memoryId` may also be a short ref or unique id prefix (LUM-1230).
 * Full-card fetch for one memory (LUM-500), consumed by `lumo memory show
 * <id>`. Workspace isolation lives in the service, which collapses
 * cross-workspace and missing ids to a single 404.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { memoryId: ref } = await params
    // LUM-1230: the CLI prints 8-char short refs; resolve them (or a unique
    // prefix) inside the caller's workspace. A full cuid passes through.
    const memoryId = await resolveMemoryRef(ref, identity.workspaceId)

    const memory = await getMemoryByIdForWorkspace(
      memoryId,
      identity.workspaceId
    )
    return NextResponse.json({ memory })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('GET /api/memories/[memoryId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { memoryId: ref } = await params
    // LUM-1230: the CLI prints 8-char short refs; resolve them (or a unique
    // prefix) inside the caller's workspace. A full cuid passes through.
    const memoryId = await resolveMemoryRef(ref, identity.workspaceId)

    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
        return NextResponse.json(
          { error: 'Content does not match the category schema' },
          { status: 400 }
        )
      }
    }

    let memory
    if (parsed.data.scope === 'PROJECT') {
      memory = await memoryManagementService.promoteToProject(memoryId, content)
    } else {
      // scope absent ⇒ the Zod refine guarantees content is present, but the
      // compiler can't see that. Guard explicitly instead of casting, so a
      // future refine change can't silently leak undefined into editContent.
      if (content === undefined) {
        return NextResponse.json(
          { error: 'content is required when scope is not PROJECT' },
          { status: 400 }
        )
      }
      memory = await memoryManagementService.editContent(memoryId, content)
    }
    return NextResponse.json({ memory }, { status: 200 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('PATCH /api/memories/[memoryId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { memoryId: ref } = await params
    // LUM-1230: the CLI prints 8-char short refs; resolve them (or a unique
    // prefix) inside the caller's workspace. A full cuid passes through.
    const memoryId = await resolveMemoryRef(ref, identity.workspaceId)

    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // LUM-793: the detector needs the caller's identity + Claude Code session
    // to attribute a used-TRAP deletion to the task the agent is working on.
    await memoryManagementService.delete(memoryId, {
      sessionId: request.headers.get('X-Lumo-Session-Id'),
      memberId: identity.memberId,
      source: identity.source,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('DELETE /api/memories/[memoryId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
