/**
 * LUM-732 / LUM-739 — copy a prior human disposition onto a new finding with
 * the same fingerprint (cross-push inheritance). Pure; moved out of
 * `pr-security-scan.service.ts` so the hunt workflow's persistence can share
 * it without importing stage A (which would close an import cycle:
 * stage A → hunt-start → workflow → steps → hunt service → stage A).
 */
import type {
  NewFindingInput,
  DispositionedFingerprint,
} from '@/lib/repositories/pr-security-scan.repository'

export function inheritDispositions(
  fresh: NewFindingInput[],
  prior: DispositionedFingerprint[]
): NewFindingInput[] {
  const byFp = new Map<string, DispositionedFingerprint>()
  for (const p of prior)
    if (!byFp.has(p.fingerprint)) byFp.set(p.fingerprint, p)
  return fresh.map(f => {
    const p = byFp.get(f.fingerprint)
    if (!p) return f
    return {
      ...f,
      disposition: p.disposition,
      dispositionNote: p.dispositionNote,
      dispositionedById: p.dispositionedById,
      dispositionedAt: p.dispositionedAt,
      inheritedFromFindingId: p.id,
    }
  })
}
