'use client'

import { useGateAudit } from '../hooks/useGateAudit'
import { DeliveryGatesByPrPanel } from './DeliveryGatesByPrPanel'

/**
 * Data-fetching wrapper that mounts the audit-only mechanical-gates panel on
 * the delivery card (LUM-614 / LUM-617). Keeps DeliveryPanel free of this
 * concern (SRP): it fetches the per-PR gate read-model and renders the pure
 * panel, or nothing while loading / when there are no PRs and no unlinked
 * signals to show.
 */
export function DeliveryGatesSection({ taskId }: { taskId: string }) {
  const { perPr, isLoading } = useGateAudit(taskId)
  if (isLoading || !perPr) return null
  if (perPr.prs.length === 0 && !perPr.unlinked) return null
  return <DeliveryGatesByPrPanel perPr={perPr} />
}
