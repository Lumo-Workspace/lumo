import {
  workspaceRepository,
  type WorkspaceUpdateData,
} from '@/lib/repositories/workspace.repository'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'
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
import {
  auditedWorkspaceSettings,
  pluginWorkspaceWrites,
  toWorkspaceColumnWrites,
} from '@/lib/plugins/workspace-settings'
import {
  auditedColumns,
  diffWorkspaceSettings,
} from '@/lib/audit/workspace-settings'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * The core settings, plus (LUM-1062) any column an installed plugin owns —
 * already validated by that plugin's validator at the API edge, written in
 * the same update. Keys no installed plugin owns are ignored.
 */
export type UpdateWorkspaceInput = CoreWorkspaceSettingsInput &
  Record<string, unknown>

interface CoreWorkspaceSettingsInput {
  name?: string | undefined
  slug?: string | undefined
  summaryEnabled?: boolean | undefined
  summaryFrequency?: string | undefined
  /** LUM-1097: one of SUPPORTED_LOCALES (validated at the API edge). */
  defaultLocale?: string | undefined
  /** LUM-859: one of HOOK_EVENT_RETENTION_DAYS; null = keep forever. */
  hookEventRetentionDays?: HookEventRetentionDays | null | undefined
  /** LUM-933: session record mode; USED_UP clears hookEventRetentionDays. */
  hookEventRetentionMode?: HookEventRetentionMode | undefined
  /** LUM-912: one of CROSSING_RAW_RETENTION_DAYS. */
  crossingRawRetentionDays?: CrossingRawRetentionDays | undefined
  /** LUM-941: one of DEAD_LETTER_RETENTION_DAYS. */
  deadLetterRetentionDays?: DeadLetterRetentionDays | undefined
  /** LUM-917: generate AI-derived content (memories, summaries). */
  aiDerivedContentEnabled?: boolean | undefined
  /** LUM-1334: DONE requires a passing test case / a review on each PR head. */
  doneRequiresTestCase?: boolean | undefined
  doneRequiresReview?: boolean | undefined
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

/**
 * LUM-907: the audited settings before a change, for the audit diff. A failed
 * read never blocks the settings change — the event then shows no `from`.
 */
async function auditedSettingsBefore(
  workspaceId: string,
  columns: readonly string[]
): Promise<Record<string, unknown> | null> {
  try {
    return await workspaceRepository.findAuditedSettings(workspaceId, columns)
  } catch {
    return null
  }
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
    input: UpdateWorkspaceInput,
    audit?: AuditContext
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
    if (input.defaultLocale !== undefined)
      data.defaultLocale = input.defaultLocale
    if (input.deadLetterRetentionDays !== undefined)
      data.deadLetterRetentionDays = input.deadLetterRetentionDays
    if (input.aiDerivedContentEnabled !== undefined)
      data.aiDerivedContentEnabled = input.aiDerivedContentEnabled
    if (input.doneRequiresTestCase !== undefined)
      data.doneRequiresTestCase = input.doneRequiresTestCase
    if (input.doneRequiresReview !== undefined)
      data.doneRequiresReview = input.doneRequiresReview
    // LUM-1062: plugin-owned columns (e.g. the security plugin's policy,
    // evidence retention and scan switches) go in the same update + audit.
    Object.assign(data, pluginWorkspaceWrites(input))

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

    // LUM-1065: the core's audited columns plus the installed plugins'.
    const audited = auditedWorkspaceSettings()
    const before = await auditedSettingsBefore(
      workspaceId,
      auditedColumns(audited)
    )
    const updated = await workspaceRepository.update(
      workspaceId,
      toWorkspaceColumnWrites(data)
    )
    // LUM-907: one event per setting category that actually changed.
    for (const change of diffWorkspaceSettings(
      before ?? {},
      data as Record<string, unknown>,
      audited
    )) {
      await recordAuditEvent({
        workspaceId,
        action: change.action,
        target: { type: 'workspace', id: workspaceId },
        metadata: { changes: change.changes },
        context: audit,
      })
    }
    return updated
  },
}
