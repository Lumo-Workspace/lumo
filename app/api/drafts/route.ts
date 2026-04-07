import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl, zodError } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import {
  upsertDraftSchema,
  taskDraftDataSchema,
  projectDraftDataSchema,
} from '@/lib/validation/schemas'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const { member } = wsResult

    const actor = await prisma.actor.findUnique({
      where: { memberId: member.id },
    })
    if (!actor) {
      return NextResponse.json({ drafts: [] })
    }

    const drafts = await prisma.draft.findMany({
      where: {
        workspaceId: wsResult.workspace.id,
        creatorId: actor.id,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        type: true,
        data: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ drafts })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = upsertDraftSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { id, workspaceUrl, type, data } = parsed.data

    // Validate data shape based on type
    const dataSchema =
      type === 'TASK' ? taskDraftDataSchema : projectDraftDataSchema
    const dataParsed = dataSchema.safeParse(data)
    if (!dataParsed.success) return zodError(dataParsed)

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const { member } = wsResult

    const actor = await prisma.actor.findUnique({
      where: { memberId: member.id },
    })
    if (!actor) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    let draft
    if (id) {
      // Update existing draft — verify ownership
      const existing = await prisma.draft.findUnique({ where: { id } })
      if (!existing || existing.creatorId !== actor.id) {
        return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
      }
      draft = await prisma.draft.update({
        where: { id },
        data: { data: dataParsed.data, type },
        select: {
          id: true,
          type: true,
          data: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    } else {
      // Create new draft
      draft = await prisma.draft.create({
        data: {
          workspaceId: wsResult.workspace.id,
          creatorId: actor.id,
          type,
          data: dataParsed.data,
        },
        select: {
          id: true,
          type: true,
          data: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    }

    return NextResponse.json({ draft }, { status: id ? 200 : 201 })
  } catch (err) {
    console.error('[POST /api/drafts]', err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
