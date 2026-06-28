'use client'

import { useGateAudit } from '../hooks/useGateAudit'
import { DeliveryGatesPanel } from './DeliveryGatesPanel'

/**
 * Data-fetching wrapper that mounts the audit-only mechanical-gates panel on
 * the delivery card (LUM-614). Keeps DeliveryPanel free of this concern (SRP):
 * it fetches the per-delivery gate read-model and renders the pure panel, or
 * nothing while loading / when there's no audit yet.
 */
export function DeliveryGatesSection({ taskId }: { taskId: string }) {
  const { audit, isLoading } = useGateAudit(taskId)
  if (isLoading || !audit) return null
  return <DeliveryGatesPanel audit={audit} />
}
