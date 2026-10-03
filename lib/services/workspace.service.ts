import {
  workspaceRepository,
  type WorkspaceUpdateData,
} from '@/lib/repositories/workspace.repository'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'
import type { SecurityPolicy } from '@/lib/security-scan/policy'
import {
  nextSessionRecordCutoff,
  sessionRecordChoiceOf,
  type HookEventRetentionDays,
  type HookEventRetentionMode,
} from '@/lib/hook-event/retention'
import {
  nextCrossingRawRetentionSince,
  type CrossingRawRetentionDays,
} from '@/lib/boundary-crossing/raw-retention'
import type { DeadLetterRetentionDays } from '@/lib/integrations/github/dead-letter-retention'
import type { ScanEvidenceRetentionDays } from '@/lib/security-scan/evidence-retention'

// ── Types ───────────────────────────────────────────────────────────────────

export interface UpdateWorkspaceInput {
  name?: string | undefined
  slug?: string | undefined
  summaryEnabled?: boolean | undefined
  summaryFrequency?: string | undefined
  summaryLocale?: string | undefined
  /** LUM-740: already validated by `securityPolicySchema`; null = reset. */
  securityPolicy?: SecurityPolicy | null | undefined
  /** LUM-859: one of HOOK_EVENT_RETENTION_DAYS; null = keep forever. */
  hookEventRetentionDays?: HookEventRetentionDays | null | undefined
  /** LUM-911: one of SCAN_EVIDENCE_RETENTION_DAYS; 0 = zero retention. */
  scanEvidenceRetentionDays?: ScanEvidenceRetentionDays | undefined
  /** LUM-933: session record mode; USED_UP clears hookEventRetentionDays. */
  hookEventRetentionMode?: HookEventRetentionMode | undefined
  /** LUM-912: one of CROSSING_RAW_RETENTION_DAYS. */
  crossingRawRetentionDays?: CrossingRawRetentionDays | undefined
  /** LUM-941: one of DEAD_LETTER_RETENTION_DAYS. */
  deadLetterRetentionDays?: DeadLetterRetentionDays | undefined
  /** LUM-866: per-workspace security-scan switches. */
  securityScanEnabled?: boolean | undefined
  securityAiReviewEnabled?: boolean | undefined
  securityHuntEnabled?: boolean | undefined
}

// ── Retention changes (LUM-933) ─────────────────────────────────────────────

/**
 * The columns a session record / crossing retention change writes. A
 * stricter setting only governs data stored afterwards: the cutoff columns
 * move with it (lib/hook-event/retention.ts nextSessionRecordCutoff,
 * lib/boundary-crossing/raw-retention.ts nextCrossingRawRetentionSince).
 */
async function retentionChangeData(
  workspaceId: string,
  input: UpdateWorkspaceInput,
  now: Date
): Promise<WorkspaceUpdateData> {
  const data: WorkspaceUpdateData = {}
  const stored = await workspaceRepository.findRetentionSettings(workspaceId)
  if (!stored) {
    throw Object.assign(new Error('Workspace not found'), { status: 404 })
  }

  if (
    input.hookEventRetentionMode !== undefined ||
    input.hookEventRetentionDays !== undefined
  ) {
    // The pre-LUM-933 single-field form (days only) is always a RETAIN choice.
    const mode = input.hookEventRetentionMode ?? 'RETAIN'
    const days =
      mode === 'USED_UP' ? null : (input.hookEventRetentionDays ?? null)
    if (mode === 'USED_UP' && input.hookEventRetentionDays != null) {
      throw Object.assign(
        new Error(
          'Used-up mode has no day tier: send hookEventRetentionDays null'
        ),
        { status: 400 }
      )
    }
    const cutoff = nextSessionRecordCutoff({
      from: sessionRecordChoiceOf(
        stored.hookEventRetentionMode,
        stored.hookEventRetentionDays
      ),
      to: sessionRecordChoiceOf(mode, days),
      current: {
        since: stored.hookEventRetentionSince,
        legacyDays: stored.hookEventRetentionLegacyDays,
      },
      now,
    })
    data.hookEventRetentionMode = mode
    data.hookEventRetentionDays = days
    data.hookEventRetentionSince = cutoff.since
    data.hookEventRetentionLegacyDays = cutoff.legacyDays
  }

  if (input.crossingRawRetentionDays !== undefined) {
    data.crossingRawRetentionDays = input.crossingRawRetentionDays
    data.crossingRawRetentionSince = nextCrossingRawRetentionSince({
      fromDays: stored.crossingRawRetentionDays,
      toDays: input.crossingRawRetentionDays,
      since: stored.crossingRawRetentionSince,
      now,
    })
  }
  return data
}

// ── Workspace Service ───────────────────────────────────────────────────────

export const workspaceService = {
  /** Create a new workspace with full initialisation (team, member, actors). */
  async createWorkspace(
    userId: string,
    data: { name: string; slug?: string | undefined }
  ) {
    const slug = data.slug ?? generateWorkspaceSlug(data.name)

    return workspaceRepository.create({
      name: data.name,
      slug,
      clerkId: userId,
    })
  },

  /** Update workspace settings. Only OWNER role is allowed. */
  async updateWorkspace(
    workspaceId: string,
    role: string,
    currentSlug: string,
    input: UpdateWorkspaceInput
  ) {
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error('Only admins can update workspace settings'),
        { status: 403 }
      )
    }

    // Check slug uniqueness if changing
    if (input.slug && input.slug !== currentSlug) {
      const unique = await workspaceRepository.isSlugUnique(
        input.slug,
        workspaceId
      )
      if (!unique) {
        throw Object.assign(new Error('This URL is already taken'), {
          status: 409,
        })
      }
    }

    const data: import('@/lib/repositories/workspace.repository').WorkspaceUpdateData =
      {}
    if (input.name !== undefined) data.name = input.name
    if (input.slug !== undefined) data.slug = input.slug
    if (input.summaryEnabled !== undefined)
      data.summaryEnabled = input.summaryEnabled
    if (input.summaryFrequency !== undefined)
      data.summaryFrequency = input.summaryFrequency
    if (input.summaryLocale !== undefined)
      data.summaryLocale = input.summaryLocale
    if (input.securityPolicy !== undefined)
      data.securityPolicy = input.securityPolicy
    if (input.scanEvidenceRetentionDays !== undefined)
      data.scanEvidenceRetentionDays = input.scanEvidenceRetentionDays
    if (input.deadLetterRetentionDays !== undefined)
      data.deadLetterRetentionDays = input.deadLetterRetentionDays
    if (input.securityScanEnabled !== undefined)
      data.securityScanEnabled = input.securityScanEnabled
    if (input.securityAiReviewEnabled !== undefined)
      data.securityAiReviewEnabled = input.securityAiReviewEnabled
    if (input.securityHuntEnabled !== undefined)
      data.securityHuntEnabled = input.securityHuntEnabled

    if (
      input.hookEventRetentionMode !== undefined ||
      input.hookEventRetentionDays !== undefined ||
      input.crossingRawRetentionDays !== undefined
    ) {
      Object.assign(
        data,
        await retentionChangeData(workspaceId, input, new Date())
      )
    }

    return workspaceRepository.update(workspaceId, data)
  },
}
