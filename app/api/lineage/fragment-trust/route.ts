import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireIdentity } from '@/lib/auth/identity'
import { lineageService } from '@/lib/services/lineage.service'

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).max(200),
})

export async function POST(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  let ids: string[]
  try {
    ids = bodySchema.parse(await request.json()).ids
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const trust = await lineageService.fragmentTrustForMemories(ids)
  return NextResponse.json({ trust })
}
