import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  USED_UP_GRACE_DAYS,
  isHookEventRetentionDays,
  type HookEventRetentionDays,
  type HookEventRetentionMode,
} from '@/lib/hook-event/retention'
import { resolvePublicUrl } from '@/lib/utils/public-url'
import { logger } from '@/lib/logger'

/**
 * LUM-943 — the one-line notice `lumo setup` and the session-start hook show a
 * CLI member: how this workspace stores their Claude Code session records and
 * where an OWNER changes it. Read fresh on every call (no cache), so a mode
 * change shows up on the very next session start.
 */
export interface SessionRecordNotice {
  mode: HookEventRetentionMode
  /** RETAIN day tier; null = kept forever (RETAIN) or not applicable (USED_UP). */
  days: HookEventRetentionDays | null
  settingsUrl: string
  /** The rendered line, ready to print. */
  notice: string
}

/** Settings → Data retention, as an absolute link the CLI can print. */
export function sessionRecordSettingsUrl(
  baseUrl: string,
  workspaceSlug: string
): string {
  return `${baseUrl}/workspace/${encodeURIComponent(workspaceSlug)}/settings/data-retention`
}

/**
 * Facts only: what is stored, how long it is kept, who can change it. No
 * encryption claim of any kind (storage relies on the database's default
 * at-rest encryption, nothing app-level).
 */
export function renderSessionRecordNotice(input: {
  mode: HookEventRetentionMode
  days: HookEventRetentionDays | null
  settingsUrl: string
}): string {
  const policy =
    input.mode === 'USED_UP'
      ? `code and command output are not stored, and the rest is discarded ${USED_UP_GRACE_DAYS} days after its work is used up`
      : input.days === null
        ? 'kept forever, including code and command output'
        : `kept for at least ${input.days} days, including code and command output`
  return `Session records in this workspace: ${policy}; credentials are always redacted. An OWNER can change this in Settings → Data retention: ${input.settingsUrl}`
}

export const sessionRecordNoticeService = {
  /**
   * The workspace's current session record notice. Never throws: null when
   * the workspace is gone or the lookup fails, so callers (session-start,
   * `lumo setup`) skip the line instead of failing.
   */
  async getForWorkspace(
    workspaceId: string
  ): Promise<SessionRecordNotice | null> {
    try {
      const row =
        await workspaceRepository.findSessionRecordSetting(workspaceId)
      if (!row) return null
      const mode = row.hookEventRetentionMode
      const days =
        mode === 'RETAIN' &&
        isHookEventRetentionDays(row.hookEventRetentionDays)
          ? row.hookEventRetentionDays
          : null
      const settingsUrl = sessionRecordSettingsUrl(resolvePublicUrl(), row.slug)
      return {
        mode,
        days,
        settingsUrl,
        notice: renderSessionRecordNotice({ mode, days, settingsUrl }),
      }
    } catch (error) {
      logger.warn('[session-record-notice] lookup failed', {
        workspaceId,
        error: (error as Error).message,
      })
      return null
    }
  },
}
