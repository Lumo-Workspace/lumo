import { apiFetch } from './base'
import type { TrustVerdict } from '@/types/lineage'

export const lineageClient = {
  /** Batched per-memory trust verdicts (LUM-303). Empty for ids with no signal. */
  fragmentTrust(
    ids: string[]
  ): Promise<{ trust: Record<string, TrustVerdict> }> {
    return apiFetch('/api/lineage/fragment-trust', {
      method: 'POST',
      body: { ids },
    })
  },
}
