/**
 * LUM-832 — the internal reliability read-out: our-fault rate and hunt
 * coverage over a time window, from the stored scan rows. Never on a customer
 * surface — the customer is told only in progress / checked / unfinished.
 *
 * Layering: service — rows through the repository, the arithmetic in the pure
 * `lib/security-scan/reliability.ts`.
 */
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  summarizeScanReliability,
  type ScanReliability,
} from '@/ee/security/security-scan/reliability'

/** Default window: the last seven days. */
export const RELIABILITY_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export const securityScanReliabilityService = {
  async summarize(
    opts: { since?: Date; until?: Date } = {}
  ): Promise<ScanReliability & { since: string; until: string }> {
    const until = opts.until ?? new Date()
    const since =
      opts.since ?? new Date(until.getTime() - RELIABILITY_DEFAULT_WINDOW_MS)
    const rows = await prSecurityScanRepository.findForReliability(since, until)
    return {
      ...summarizeScanReliability(rows),
      since: since.toISOString(),
      until: until.toISOString(),
    }
  },
}
