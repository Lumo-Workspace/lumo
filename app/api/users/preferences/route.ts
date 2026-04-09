import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { miscRepository } from '@/lib/repositories/misc.repository'

const VALID_THEMES = ['light', 'dark', 'system'] as const
const VALID_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'en-GB',
  'en-AU',
  'es-ES',
  'es-419',
  'fr',
  'de',
  'ja',
  'ko',
  'hi',
  'ru',
  'vi',
  'id',
  'ms',
] as const

const BOOLEAN_FIELDS = [
  'notifyInAppAssigned',
  'notifyInAppComment',
  'notifyInAppAgentDone',
  'notifyInAppAgentInput',
  'notifyInAppMention',
  'notifySlackAssigned',
  'notifySlackComment',
  'notifySlackAgentDone',
  'notifySlackAgentInput',
  'notifySlackMention',
] as const

const DEFAULTS = {
  theme: 'system',
  locale: 'en',
  timezone: 'auto',
  notifyInAppAssigned: true,
  notifyInAppComment: true,
  notifyInAppAgentDone: true,
  notifyInAppAgentInput: true,
  notifyInAppMention: true,
  notifySlackAssigned: true,
  notifySlackComment: true,
  notifySlackAgentDone: true,
  notifySlackAgentInput: true,
  notifySlackMention: true,
}

function toResponse(pref: Record<string, unknown>) {
  const { id, memberId, createdAt, updatedAt, ...rest } = pref
  return rest
}

async function resolveMember(userId: string) {
  const ws = await getUserWorkspace(userId)
  if (!ws) return null
  return ws.member
}

export async function GET(_request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await resolveMember(userId)
    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
    }

    const pref = await miscRepository.findUserPreference(member.id)

    return NextResponse.json(pref ? toResponse(pref) : DEFAULTS)
  } catch (error) {
    console.error('GET /api/users/preferences error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await resolveMember(userId)
    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 403 })
    }

    const body = await request.json()
    const update: Record<string, unknown> = {}

    if (body.theme !== undefined) {
      if (!VALID_THEMES.includes(body.theme)) {
        return NextResponse.json(
          {
            error: `Invalid theme. Must be one of: ${VALID_THEMES.join(', ')}`,
          },
          { status: 400 }
        )
      }
      update.theme = body.theme
    }

    if (body.locale !== undefined) {
      if (!VALID_LOCALES.includes(body.locale)) {
        return NextResponse.json(
          {
            error: `Invalid locale. Must be one of: ${VALID_LOCALES.join(', ')}`,
          },
          { status: 400 }
        )
      }
      update.locale = body.locale
    }

    if (typeof body.timezone === 'string' && body.timezone.trim()) {
      update.timezone = body.timezone.trim()
    }

    for (const field of BOOLEAN_FIELDS) {
      if (typeof body[field] === 'boolean') {
        update[field] = body[field]
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      )
    }

    const pref = await miscRepository.upsertUserPreference(member.id, update)

    return NextResponse.json(toResponse(pref))
  } catch (error) {
    console.error('PATCH /api/users/preferences error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
