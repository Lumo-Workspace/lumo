/**
 * LUM-1135: the `[caseRef]` route segment, shared by the task and milestone
 * routes. Accepts a cuid, `TC3` or `3`. Pure — the owner scoping (a number or
 * cuid only means something inside its own task / milestone) is the caller's.
 */
export type CaseRef =
  | { kind: 'id'; id: string }
  | { kind: 'number'; number: number }

/** A Prisma cuid: `c` + 24 lowercase alphanumerics. */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

export function parseCaseRef(raw: string): CaseRef | null {
  const ref = raw.trim()
  if (isLikelyCuid(ref)) return { kind: 'id', id: ref }
  const m = /^(?:TC)?(\d+)$/i.exec(ref)
  if (!m) return null
  const number = parseInt(m[1]!, 10)
  if (!Number.isSafeInteger(number) || number < 1) return null
  return { kind: 'number', number }
}
