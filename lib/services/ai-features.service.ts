import { isAiConfigured } from '@/lib/ai/routing'
import {
  AI_FEATURE_KEYS,
  AI_FEATURE_OFF_CODE,
  AI_NOT_CONFIGURED_CODE,
  PLUGIN_AI_FEATURES,
  isAiFeatureOn,
  parseAiFeatureSwitches,
  resolveAiFeatures,
  withSwitch,
  type AiFeature,
  type AiFeatureSwitches,
  type AiSwitchKey,
} from '@/lib/ai-features/registry'
import {
  aiFeatureSwitchRepository,
  type AiFeatureSwitchRef,
} from '@/lib/repositories/ai-feature-switch.repository'
import type { AuditContext } from '@/lib/services/audit.service'
import { logger } from '@/lib/logger'

export interface AiFeaturesStatus {
  /** Whether the deployment has a model configured (AI_GATEWAY_API_KEY, …). */
  aiConfigured: boolean
  /** The switches as stored (absent = on). */
  switches: AiFeatureSwitches
  /** The features this server has, in settings-page order. */
  available: AiFeature[]
  /** Whether each feature runs right now. */
  effective: Record<AiFeature, boolean>
}

/** The error a switched-off or unconfigured feature is refused with. */
export function aiFeatureUnavailableError(feature: AiFeature): Error {
  return isAiConfigured()
    ? Object.assign(
        new Error(
          `The AI feature "${feature}" is turned off for this workspace`
        ),
        { status: 409, code: AI_FEATURE_OFF_CODE }
      )
    : Object.assign(new Error('AI is not configured on this deployment'), {
        status: 503,
        code: AI_NOT_CONFIGURED_CODE,
      })
}

/** Plugin-provided features exist only when a plugin gates AI review. */
async function availableFeatures(): Promise<AiFeature[]> {
  // Loaded lazily: the registry loads every installed plugin.
  const { getPluginRegistry } = await import('@/lib/plugins/registry')
  const hasReviewPlugin = getPluginRegistry().workspaceSettings.some(
    c => c.aiReviewEnabled
  )
  return AI_FEATURE_KEYS.filter(
    f => hasReviewPlugin || !PLUGIN_AI_FEATURES.includes(f)
  )
}

/**
 * LUM-1338 — the workspace's AI feature switches: the master switch, one per
 * group, one per feature. Every AI feature asks `isEnabled` before it calls a
 * model, so a switched-off feature never runs and a deployment without a
 * model never tries.
 */
export const aiFeaturesService = {
  /**
   * May `feature` call a model for the workspace `ref` belongs to? False
   * without a configured model, and on an unreadable switch (skipping an AI
   * helper is harmless; running one the OWNER turned off is not).
   */
  async isEnabled(
    ref: AiFeatureSwitchRef,
    feature: AiFeature
  ): Promise<boolean> {
    if (!isAiConfigured()) return false
    try {
      const raw = await aiFeatureSwitchRepository.findRaw(ref)
      if (raw === null) return false
      return isAiFeatureOn(parseAiFeatureSwitches(raw), feature, true)
    } catch (err) {
      logger.warn('[ai-features] switch read failed — feature skipped', {
        ref,
        feature,
        err,
      })
      return false
    }
  },

  /**
   * For batch jobs: the workspaces that switched `feature` off, to leave
   * out in the batch query itself.
   */
  workspaceIdsWithFeatureOff(feature: AiFeature): Promise<string[]> {
    return aiFeatureSwitchRepository.findWorkspaceIdsWithFeatureOff(feature)
  },

  /** Whether the deployment has a model configured at all. */
  isAiConfigured(): boolean {
    return isAiConfigured()
  },

  /**
   * For user-triggered features: throw unless `feature` may run — 503
   * `AI_NOT_CONFIGURED` without a model, 409 `AI_FEATURE_OFF` when switched
   * off. The UI hides these entry points, so this guards stale pages and
   * direct API calls.
   */
  async assertEnabled(
    ref: AiFeatureSwitchRef,
    feature: AiFeature
  ): Promise<void> {
    if (await this.isEnabled(ref, feature)) return
    throw aiFeatureUnavailableError(feature)
  },

  /** Any member: what the UI needs to show or hide AI entry points. */
  async getStatus(workspaceId: string): Promise<AiFeaturesStatus> {
    const aiConfigured = isAiConfigured()
    const switches = parseAiFeatureSwitches(
      await aiFeatureSwitchRepository.findRaw({ workspaceId })
    )
    return {
      aiConfigured,
      switches,
      available: await availableFeatures(),
      effective: resolveAiFeatures(switches, aiConfigured),
    }
  },

  /**
   * Set one switch. OWNER only — enforced (and audited) by the workspace
   * settings write it delegates to. The master switch cannot be turned on
   * while the deployment has no model configured.
   */
  async setSwitch(
    workspace: { id: string; slug: string },
    role: string,
    key: AiSwitchKey,
    enabled: boolean,
    audit?: AuditContext
  ): Promise<AiFeaturesStatus> {
    if (key.level === 'master' && enabled && !isAiConfigured()) {
      throw Object.assign(
        new Error(
          'AI is not configured on this deployment. Set AI_GATEWAY_API_KEY, ANTHROPIC_API_KEY or OPENAI_COMPATIBLE_BASE_URL, then restart Lumo.'
        ),
        { status: 409, code: AI_NOT_CONFIGURED_CODE }
      )
    }
    // Loaded lazily: every AI feature imports this service for `isEnabled`,
    // and the settings write path pulls in the whole workspace service.
    const { workspaceService } =
      await import('@/lib/services/workspace.service')
    const current = parseAiFeatureSwitches(
      await aiFeatureSwitchRepository.findRaw({ workspaceId: workspace.id })
    )
    await workspaceService.updateWorkspace(
      workspace.id,
      role,
      workspace.slug,
      { aiFeatureSwitches: withSwitch(current, key, enabled) },
      audit
    )
    return this.getStatus(workspace.id)
  },
}
