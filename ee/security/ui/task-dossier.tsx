'use client'

/**
 * LUM-1062 — the security plugin's part of the task dossier (the
 * `task.dossier` slot): the blocking-finding count for the Done gate, the
 * blocking findings for Needs action, and the scan report as a Records row.
 * The logic is TaskDossier's before the split (LUM-496 / LUM-1009).
 */
import { useIntl } from 'react-intl'
import type { ClientSlotProps } from '@/lib/plugins/client'
import type { TaskSecurityScans } from '@/ee/security/services/pr-security-scan.service'
import { useSecurityScans } from '@/ee/security/hooks/useSecurityScans'
import {
  BlockingSecurityFindings,
  SecurityScanSection,
} from '@/ee/security/components/TaskDetailTimeline/SecurityScanSection'
import { RecordRow } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordRow'
import {
  CopyReviewForAgent,
  LumoReviewSummary,
} from '@/ee/security/components/TaskDetailTimeline/LumoReviewHeader'
import { reviewVerdict } from '@/ee/security/components/TaskDetailTimeline/lumo-review-checks'

export function SecurityTaskDossier({
  taskId,
  expanded,
  onToggle,
  children,
}: ClientSlotProps['task.dossier']) {
  const intl = useIntl()
  // LUM-496: the Done gate needs to know whether a security finding still
  // blocks DONE. Same react-query key `SecurityScanSection` uses (one
  // fetch); absent data means "no blocking signal we know of", never a
  // fabricated 0 finding.
  const { data: securityScans, isError: securityError } =
    useSecurityScans(taskId)
  const blocking = securityScans?.blocking.count ?? 0
  const checked = (securityScans?.prs ?? []).some(p => p.latest !== null)
  // LUM-1009: the Records row for the security scan. Shown whenever the task
  // has a PR (or the read failed — said out loud inside, review I4).
  const showRecord = securityError || (securityScans?.prs.length ?? 0) > 0

  // LUM-1009: the full scan report as a Records row — never moves, whether
  // or not a finding blocks (blocking findings also come up in Needs action).
  const record = showRecord ? (
    <RecordRow
      id='dossier-security'
      title={intl.formatMessage({ id: 'securityScan.section.title' })}
      {...(securityScans
        ? {
            // LUM-1308: the verdict as one badge; the header also carries
            // "Copy for agent" for every finding still to decide on.
            summary: <LumoReviewSummary data={securityScans} />,
            ...(hasFindingsToDecide(securityScans)
              ? { actions: <CopyReviewForAgent data={securityScans} /> }
              : {}),
          }
        : {})}
      expanded={expanded}
      onToggle={onToggle}
    >
      <SecurityScanSection taskId={taskId} />
    </RecordRow>
  ) : null

  return (
    <>
      {children({
        blocking,
        checked,
        needsAction: <BlockingSecurityFindings taskId={taskId} />,
        record,
      })}
    </>
  )
}

/** Something to copy for an agent: a finding still to decide on. */
function hasFindingsToDecide(data: TaskSecurityScans): boolean {
  const { kind } = reviewVerdict(data)
  return kind === 'blocking' || kind === 'open'
}
