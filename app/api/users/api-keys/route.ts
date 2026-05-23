import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

/**
 * GET /api/users/api-keys
 * Lists active (non-revoked) API keys for the current user.
 * Never returns the full key — only prefix and metadata.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const keys = await miscRepository.findActiveApiKeys(ws.member.id)

    return NextResponse.json({ keys })
  } catch (error) {
    console.error('GET /api/users/api-keys error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/users/api-keys
 * Creates a new API key. Returns the full key ONCE — never stored in plaintext.
 * Body: { label: string }
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const body = await request.json()
    const label = (body?.label ?? '').trim()
    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 400 })
    }

    // Generate key: "lum_" + 64 random hex chars = 68 chars total
    const raw = randomBytes(32).toString('hex')
    const key = `lum_${raw}`
    const keyHash = createHash('sha256').update(key).digest('hex')
    const keyPrefix = key.slice(0, 16) // "lum_xxxxxxxxxxxx"

    const created = await miscRepository.createApiKey({
      workspaceMemberId: ws.member.id,
      label,
      keyHash,
      keyPrefix,
    })

    // Return the full key only on creation
    return NextResponse.json({ ...created, key }, { status: 201 })
  } catch (error) {
    console.error('POST /api/users/api-keys error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
