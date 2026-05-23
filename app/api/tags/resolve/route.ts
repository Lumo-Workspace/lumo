import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { tagRepository } from '@/lib/repositories/tag.repository'

const bodySchema = z.object({
  names: z.array(z.string()).max(20),
})

/**
 * POST /api/tags/resolve — Find-or-create tags by name (idempotent, CLI use).
 *
 * Unlike POST /api/tags which returns 409 on duplicate names, this endpoint
 * always returns the existing-or-newly-created tag for each name. Intended for
 * CLI workflows that need to resolve a list of tag names to IDs.
 *
 * Body: { names: string[] }   (max 20 entries)
 * Response: { tags: Array<{ id, name, color, workspaceId, createdAt }> }
 */
export async function POST(req: NextRequest): Promise<Response> {
  // 1. Auth
  const authResult = await requireAuth()
  if (authResult instanceof Response) return authResult

  const { userId } = authResult

  // 2. Workspace
  const ws = await requireUserWorkspace(userId)
  if (ws instanceof Response) return ws

  // 3. Parse + validate body
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // 4. Trim names; reject any empty-after-trim
  const trimmed = parsed.data.names.map(n => n.trim())
  const emptyName = trimmed.find(n => n.length === 0)
  if (emptyName !== undefined) {
    return NextResponse.json(
      { error: 'Tag names must not be empty or whitespace-only' },
      { status: 400 }
    )
  }

  // 5. Dedupe case-insensitively (preserve first-seen casing)
  const seen = new Map<string, string>()
  for (const name of trimmed) {
    const key = name.toLowerCase()
    if (!seen.has(key)) seen.set(key, name)
  }
  const cleaned = [...seen.values()]

  // 6. Post-dedupe count cap (already capped pre-dedupe by schema, but
  //    dedupe can only shrink — this guard is a safety belt)
  if (cleaned.length > 20) {
    return NextResponse.json(
      { error: 'Too many tag names (max 20)' },
      { status: 400 }
    )
  }

  // 7. Find-or-create
  const tags = await tagRepository.findOrCreateMany(ws.workspaceId, cleaned)

  return NextResponse.json({ tags })
}
