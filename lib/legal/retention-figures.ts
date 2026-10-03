/**
 * LUM-915 — the figures the public retention copy (/security, the landing
 * FAQ) quotes, read from the same constants the settings rows and the
 * cleanup sweeps use. Server-side: some of the source modules import Node's
 * `crypto`, so the client page receives this plain object as a prop.
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
import { FAILURE_ERROR_CAP } from '@/lib/hook-payload/redact'
import {
  DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  DEAD_LETTER_RETENTION_DAYS,
} from '@/lib/integrations/github/dead-letter-retention'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  SCAN_EVIDENCE_HARD_CAP_DAYS,
  SCAN_EVIDENCE_RETENTION_DAYS,
} from '@/lib/security-scan/evidence-retention'

export interface RetentionFigures {
  /** Session record day tiers an owner can pick (default: keep forever). */
  sessionDays: readonly number[]
  /** Characters of a failed command's error kept when code is stripped. */
  errorCap: number
  /** Used-up mode: days kept after the work is used up. */
  grace: number
  /** Used-up mode: days without agent activity that count as used up. */
  idle: number
  /** Used-up mode: longest wait after Done for the post-Done review. */
  auditCap: number
  scanDefault: number
  scanTiers: readonly number[]
  /** Days after a scan finished that its code is cleared on a PR that stays open. */
  openCap: number
  crossingDefault: number
  crossingTiers: readonly number[]
  deadLetterDefault: number
  deadLetterTiers: readonly number[]
}

export const RETENTION_FIGURES: RetentionFigures = {
  sessionDays: HOOK_EVENT_RETENTION_DAYS,
  errorCap: FAILURE_ERROR_CAP,
  grace: USED_UP_GRACE_DAYS,
  idle: USED_UP_IDLE_DAYS,
  auditCap: USED_UP_AUDIT_WAIT_CAP_DAYS,
  scanDefault: DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  scanTiers: SCAN_EVIDENCE_RETENTION_DAYS,
  openCap: SCAN_EVIDENCE_HARD_CAP_DAYS,
  crossingDefault: DEFAULT_CROSSING_RAW_RETENTION_DAYS,
  crossingTiers: CROSSING_RAW_RETENTION_DAYS,
  deadLetterDefault: DEAD_LETTER_PAYLOAD_RETENTION_DAYS,
  deadLetterTiers: DEAD_LETTER_RETENTION_DAYS,
}
