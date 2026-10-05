import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { documentRepository } from '@/lib/repositories'

type RawNode = Awaited<
  ReturnType<typeof documentRepository.findTreeNodes>
>[number]

interface TreeNodeResponse {
  id: string
  slug: string | null
  title: string
  emoji: string | null
  parentId: string | null
  sortOrder: number
  childCount: number
  children?: TreeNodeResponse[] | undefined
}

function toTreeNode(
  raw: RawNode,
  children?: TreeNodeResponse[]
): TreeNodeResponse {
  const result: TreeNodeResponse = {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    emoji: raw.emoji,
    parentId: raw.parentId,
    sortOrder: raw.sortOrder,
    childCount: raw._count.children,
  }
  if (children) {
    result.children = children
  }
  return result
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const expandedDocId = request.nextUrl.searchParams.get('expandedDocId')

  // 1. Build the expanded path (ancestors of expandedDocId)
  const expandedPath = new Set<string>()
  if (expandedDocId) {
    let currentId: string | null = expandedDocId
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const doc = await documentRepository.findParentId(
        currentId,
        ws.workspaceId
      )
      if (!doc) break
      expandedPath.add(doc.id)
      currentId = doc.parentId
    }
  }

  const memberId = ws.member.id

  // Permission filter: own docs + workspace-visible + docs shared with me.
  // Kept in sync with documentRepository.findByWorkspace so the sidebar tree
  // and the documents home page show the same set of documents.
  const permissionFilter = {
    workspaceId: ws.workspaceId,
    OR: [
      { createdById: memberId },
      { visibility: 'WORKSPACE' as const },
      { shares: { some: { memberId } } },
    ],
  }

  // 2. Fetch root documents
  const roots = await documentRepository.findTreeNodes({
    ...permissionFilter,
    parentId: null,
  })

  // 3. Build tree with depth 2 + expanded path
  async function buildNode(
    raw: RawNode,
    depth: number
  ): Promise<TreeNodeResponse> {
    const shouldExpand = depth < 2 || expandedPath.has(raw.id)
    if (!shouldExpand || raw._count.children === 0) {
      return toTreeNode(raw)
    }

    const childDocs = await documentRepository.findTreeNodes({
      ...permissionFilter,
      parentId: raw.id,
    })

    const children = await Promise.all(
      childDocs.map(child => buildNode(child, depth + 1))
    )

    return toTreeNode(raw, children)
  }

  const tree = await Promise.all(roots.map(root => buildNode(root, 0)))

  return NextResponse.json({ roots: tree })
}
