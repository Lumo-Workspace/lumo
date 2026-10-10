/**
 * LUM-915 — the figures the public retention copy (/security, the landing
 * FAQ) quotes, read from the same constants the settings rows and the
 * cleanup sweeps use. Server-side: some of the source modules import Node's
 * `crypto`, so the client page receives this plain object as a prop.
 *
 * LUM-1062: the core figures are constants here; a plugin adds the
 * paragraph for the data it stores (the security plugin: scan evidence)
 * through the `retention` extension point, read by `retentionFigures()`.
 */
import {
  CROSSING_RAW_RETENTION_DAYS,
  DEFAULT_CROSSING_RAW_RETENTION_DAYS,
} from '@/lib/boundary-crossing/raw-retention'
import {
  HOOK_EVENT_RETENTION_DAYS,
  USED_UP_AUDIT_WAIT_CAP_DAYS,
  USED_UP_GRACE_DAYS,
  USED_UP_IDLE_DAYS,
} from '@/lib/hook-event/retention'
import {
  COMMAND_SUMMARY_CAP,
  FAILURE_ERROR_CAP,
} from '@/lib/hook-payload/redact'
import {
  DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  DEAD_LETTER_RETENTION_DAYS,
} from '@/lib/integrations/github/dead-letter-retention'
import { pluginRetentionFigures } from '@/lib/plugins/retention'
import type { RetentionFigureContribution } from '@/lib/plugins/types'

/** The core figures (every deployment has this data). */
export interface CoreRetentionFigures {
  /** Session record day tiers an owner can pick (default: keep forever). */
  sessionDays: readonly number[]
  /** Characters of a failed command's error kept when code is stripped. */
  errorCap: number
  /** Characters of a Bash command kept when code is stripped (LUM-873). */
  commandCap: number
  /** Used-up mode: days kept after the work is used up. */
  grace: number
  /** Used-up mode: days without agent activity that count as used up. */
  idle: number
  /** Used-up mode: longest wait after Done for the post-Done review. */
  auditCap: number
  crossingDefault: number
  crossingTiers: readonly number[]
  deadLetterDefault: number
  deadLetterTiers: readonly number[]
}

export const CORE_RETENTION_FIGURES: CoreRetentionFigures = {
  sessionDays: HOOK_EVENT_RETENTION_DAYS,
  errorCap: FAILURE_ERROR_CAP,
  commandCap: COMMAND_SUMMARY_CAP,
  grace: USED_UP_GRACE_DAYS,
  idle: USED_UP_IDLE_DAYS,
  auditCap: USED_UP_AUDIT_WAIT_CAP_DAYS,
  crossingDefault: DEFAULT_CROSSING_RAW_RETENTION_DAYS,
  crossingTiers: CROSSING_RAW_RETENTION_DAYS,
  deadLetterDefault: DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  deadLetterTiers: DEAD_LETTER_RETENTION_DAYS,
}

export interface RetentionFigures extends CoreRetentionFigures {
  /** Paragraphs installed plugins add, each with its own figures. */
  contributed: RetentionFigureContribution[]
}

/** The core figures plus what the installed plugins contribute. */
export function retentionFigures(): RetentionFigures {
  return { ...CORE_RETENTION_FIGURES, contributed: pluginRetentionFigures() }
}
