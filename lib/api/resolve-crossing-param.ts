import { parseCrossingRef } from '@/lib/boundary-crossing/crossing-ref'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

/**
 * LUM-1059: turn a `[crossingId]` route param into the crossing's cuid. A
 * `<TEAM>-X<n>` ref resolves within the (already resolved) task; anything else
 * passes through as a cuid. An unknown ref also passes through unchanged, so
 * the service's own lookup answers it with its usual 404.
 *
 * Runs BEFORE any read-receipt call: receipts sign the cuid (LUM-769), so a
 * receipt issued via the ref must verify via the cuid and vice versa.
 */
export async function resolveCrossingParam(
  rawCrossingId: string,
  taskId: string
): Promise<string> {
  const ref = parseCrossingRef(rawCrossingId)
  if (!ref) return rawCrossingId
  const id = await boundaryCrossingRepository.findIdByTaskAndNumber(
    taskId,
    ref.number,
    ref.teamIdentifier
  )
  return id ?? rawCrossingId
}
