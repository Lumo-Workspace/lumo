/**
 * LUM-1097 — which language a Slack message is written in.
 *
 * - Channel posts (notifications and command replies): the workspace's
 *   default language (`Workspace.defaultLocale`).
 * - DMs: the recipient's own language (`UserPreference.locale`); a member
 *   with no saved preference gets the workspace default.
 *
 * Unknown codes and failed lookups fall back (to the workspace default, then
 * English) and never throw: a language lookup must not stop a notification.
 */
import { logger } from '@/lib/logger'
import { preferenceRepository } from '@/lib/repositories/preference.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  DEFAULT_LOCALE,
  toSupportedLocale,
  type SupportedLocale,
} from '@/lib/i18n/server-messages'

export const slackLocaleService = {
  /** The workspace's default language (English when unset or unreadable). */
  async forWorkspace(workspaceId: string): Promise<SupportedLocale> {
    try {
      return toSupportedLocale(
        await workspaceRepository.findDefaultLocale(workspaceId)
      )
    } catch (error) {
      logger.warn('[slack locale] workspace language lookup failed', {
        workspaceId,
        error,
      })
      return DEFAULT_LOCALE
    }
  },

  /**
   * The language of a DM to `recipientClerkId`: their saved preference, or
   * the workspace default when they have none.
   */
  async forRecipient(
    workspaceId: string,
    recipientClerkId: string
  ): Promise<SupportedLocale> {
    const workspaceLocale = await this.forWorkspace(workspaceId)
    try {
      return toSupportedLocale(
        await preferenceRepository.findLocaleForMember(
          workspaceId,
          recipientClerkId
        ),
        workspaceLocale
      )
    } catch (error) {
      logger.warn('[slack locale] recipient language lookup failed', {
        workspaceId,
        error,
      })
      return workspaceLocale
    }
  },
}
