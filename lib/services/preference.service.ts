import { miscRepository } from '@/lib/repositories/misc.repository'

// ── Constants ───────────────────────────────────────────────────────────────

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

// ── Preference Service ──────────────────────────────────────────────────────

export const preferenceService = {
  /** Get user preferences for a member, returning defaults if none saved. */
  async getPreferences(memberId: string) {
    const pref = await miscRepository.findUserPreference(memberId)
    return pref ? toResponse(pref) : DEFAULTS
  },

  /**
   * Validate and update user preferences.
   * Returns the updated preferences or throws with status on validation error.
   */
  async updatePreferences(memberId: string, body: Record<string, unknown>) {
    const update: Record<string, unknown> = {}

    if (body.theme !== undefined) {
      if (!(VALID_THEMES as readonly string[]).includes(body.theme as string)) {
        throw Object.assign(
          new Error(
            `Invalid theme. Must be one of: ${VALID_THEMES.join(', ')}`
          ),
          { status: 400 }
        )
      }
      update.theme = body.theme
    }

    if (body.locale !== undefined) {
      if (
        !(VALID_LOCALES as readonly string[]).includes(body.locale as string)
      ) {
        throw Object.assign(
          new Error(
            `Invalid locale. Must be one of: ${VALID_LOCALES.join(', ')}`
          ),
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
      throw Object.assign(new Error('No valid fields to update'), {
        status: 400,
      })
    }

    const pref = await miscRepository.upsertUserPreference(memberId, update)
    return toResponse(pref)
  },
}
