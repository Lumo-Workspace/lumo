import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { checkDuplicatesSchema } from '@/lib/validation/schemas'
import { checkDuplicates } from '@/lib/services/duplicate-check.service'
import { aiFeaturesService } from '@/lib/services'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = checkDuplicatesSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { title, projectId } = parsed.data

    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult

    // LUM-1338: switched off (or no model) = no duplicates to show.
    if (!(await aiFeaturesService.isEnabled({ projectId }, 'duplicateCheck')))
      return NextResponse.json({ matches: [] })

    const matches = await checkDuplicates(title, projectId)
    return NextResponse.json({ matches })
  } catch (error) {
    logger.error('[check-duplicates] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
