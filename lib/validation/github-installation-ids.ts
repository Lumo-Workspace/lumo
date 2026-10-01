/**
 * LUM-927 — the `confirmRemovals` query of the access-recheck cron: `1,2,3` →
 * [1, 2, 3]. Anything that is not a positive integer is dropped, so a typo
 * confirms nothing rather than something else.
 */
export function parseInstallationIds(raw: string | null): number[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(part => Number(part.trim()))
    .filter(id => Number.isSafeInteger(id) && id > 0)
}
