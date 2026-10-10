/**
 * LUM-737 / LUM-1061 — the security plugin's part of `lumo task status`:
 * the undispositioned PR findings as SECURITY_FINDING next actions and the
 * `securityFindings` read-out. Moved out of lib/services/task-status.service.ts
 * unchanged in shape; the core merges it in through the `agentContext`
 * extension point.
 *
 * Fail-closed: a read failure becomes `securityFindings: null` ("could not
 * confirm"), never an absent field — absent means "this server has no
 * security plugin", which the CLI renders as nothing at all.
 */
import { logger } from '@/lib/logger'
import type { TaskStatusSection } from '@/lib/plugins/types'
import type {
  FindingProvenance,
  FindingSeverity,
} from '@/lib/repositories/pr-security-scan.repository'
import type { UnconfirmedPr } from '@/lib/security-scan/agent-reminder'
import type { TaskSecurityScanSummary } from '@/lib/services/pr-security-reminder.service'

export interface NextActionSecurityFinding {
  kind: 'SECURITY_FINDING'
  findingId: string
  statement: string
  severity: FindingSeverity
  provenance: FindingProvenance
  blocking: boolean
  prNumber: number
  ruleId: string
  filePath: string
  line: number | null
  /**
   * LUM-758 follow-up (secret: rows) — why the severity was lowered to LOW.
   * Additive: absent on an older server, and on any row with no downgrade.
   */
  secretDowngrade?: string | null
}

export interface TaskSecurityFindingsSummary {
  open: number
  blocking: number
  unconfirmedPrs: UnconfirmedPr[]
  /** LUM-735 — per-PR scan summary passed through from the reminder service,
   *  for `lumo task status` to render one line per scan. Additive: optional
   *  so an older cached/serialized summary without it still type-checks. */
  scans?: TaskSecurityScanSummary[]
}

declare module '@/lib/services/task-status.service' {
  interface PluginNextActionKinds {
    SECURITY_FINDING: NextActionSecurityFinding
  }
  interface TaskStatusPluginFields {
    /** LUM-737: security-scan read-out. `null` = the read failed (could NOT
     *  confirm) — distinct from `{ open: 0, … }`. */
    securityFindings?: TaskSecurityFindingsSummary | null
  }
}

export async function securityTaskStatusSection(
  taskId: string
): Promise<TaskStatusSection> {
  try {
    const [{ prSecurityReminderService }, { findingStatement }] =
      await Promise.all([
        import('@/lib/services/pr-security-reminder.service'),
        import('@/lib/security-scan/agent-reminder'),
      ])
    const state =
      await prSecurityReminderService.loadOpenFindingsForTask(taskId)
    const nextActions = state.findings.map(
      (f): NextActionSecurityFinding => ({
        kind: 'SECURITY_FINDING',
        findingId: f.id,
        statement: findingStatement(f),
        severity: f.severity,
        provenance: f.provenance,
        blocking: f.blocking,
        prNumber: f.prNumber,
        ruleId: f.ruleId,
        filePath: f.filePath,
        line: f.line,
        secretDowngrade: f.secretDowngrade ?? null,
      })
    )
    const summary: TaskSecurityFindingsSummary = {
      open: state.findings.length,
      blocking: state.blockingCount,
      unconfirmedPrs: state.unconfirmedPrs,
      scans: state.scans,
    }
    return { nextActions, fields: { securityFindings: summary } }
  } catch (error) {
    logger.warn('taskStatus.securityRead.failed', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { nextActions: [], fields: { securityFindings: null } }
  }
}
