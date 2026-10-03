import type { HookEventType } from '@prisma/client'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'
import { shouldStripCodeOnIngest } from '@/lib/hook-event/retention'
import { logger } from '@/lib/logger'

export const hookIngestPolicyService = {
  /**
   * LUM-933 — the copy of an already credential-redacted hook payload that is
   * stored. RETAIN workspaces (the default) keep it whole: the session record
   * shows the code, command output and prompts. USED_UP workspaces strip code
   * on ingest (LUM-855). When the mode cannot be read the payload is stripped
   * — the privacy-safe side of the choice.
   *
   * `redacted` MUST already have gone through `redactHookPayload`: this never
   * redacts credentials itself, it only decides whether code is also dropped.
   */
  async storedPayloadFor(
    workspaceId: string,
    type: HookEventType,
    redacted: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    let strip = true
    try {
      const mode =
        await workspaceRepository.findHookEventRetentionMode(workspaceId)
      strip = mode === null ? true : shouldStripCodeOnIngest(mode)
    } catch (error) {
      logger.warn(
        `[hook-ingest] retention mode unreadable for workspace ${workspaceId}, stripping code: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    return strip ? stripCodeFromHookPayload(type, redacted) : redacted
  },
}
