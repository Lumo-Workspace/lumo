/**
 * LUM-1230: a human-sized handle for records that have no number of their own
 * (memories, task artifacts, web / Slack / Figma links, PR findings).
 *
 * A cuid's leading characters are a timestamp, so records created in the same
 * batch share long prefixes; its last 8 characters are the random block. The
 * short ref is therefore the id's TAIL. Input stays lenient: the full id, the
 * short ref, or any unique prefix of at least {@link MIN_REF_LENGTH}
 * characters (the convention `task deps` / `task comments` already use)
 * selects a record. More than one match is an error that lists the
 * candidates — never a silent pick.
 */

export const SHORT_REF_LENGTH = 8
export const MIN_REF_LENGTH = 6

/** The display handle of an id: its last {@link SHORT_REF_LENGTH} chars. */
export function shortRef(id: string): string {
  return id.length <= SHORT_REF_LENGTH ? id : id.slice(-SHORT_REF_LENGTH)
}

/** A full Prisma cuid (`c` + 24 base36 chars). */
export function isFullCuid(value: string): boolean {
  return /^c[a-z0-9]{24}$/.test(value)
}

export type RefMatch<T> =
  | { kind: 'found'; item: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'too-short' }
  | { kind: 'not-found' }

/** Normalise user input: trim, drop a leading `#`, lowercase. */
export function normaliseRef(ref: string): string {
  return ref.trim().replace(/^#/, '').toLowerCase()
}

/**
 * Pick the record `ref` names among `items`. Pure. An exact id wins outright;
 * otherwise every id that starts or ends with the ref is a candidate.
 */
export function matchRef<T>(
  ref: string,
  items: readonly T[],
  idOf: (item: T) => string
): RefMatch<T> {
  const needle = normaliseRef(ref)
  const exact = items.find(i => idOf(i).toLowerCase() === needle)
  if (exact !== undefined) return { kind: 'found', item: exact }
  if (needle.length < MIN_REF_LENGTH) return { kind: 'too-short' }
  const hits = items.filter(i => {
    const id = idOf(i).toLowerCase()
    return id.startsWith(needle) || id.endsWith(needle)
  })
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length === 1) return { kind: 'found', item: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}

/**
 * One error sentence for a failed match, listing every candidate by its short
 * ref (and an optional label) so the caller can re-run with a longer ref.
 */
export function refMatchError<T>(
  noun: string,
  ref: string,
  match: Exclude<RefMatch<T>, { kind: 'found' }>,
  idOf: (item: T) => string,
  labelOf?: (item: T) => string,
  /** The candidate list was capped, so more ids match than are listed. */
  truncated = false
): string {
  switch (match.kind) {
    case 'too-short':
      return `${noun} ref "${ref}" is too short — use the ${SHORT_REF_LENGTH}-character ref shown in listings (or at least ${MIN_REF_LENGTH} characters of the id)`
    case 'not-found':
      return `no ${noun} matches "${ref}"`
    case 'ambiguous': {
      const list = match.candidates
        .map(c => {
          const label = labelOf?.(c)
          return label ? `${idOf(c)} (${label})` : idOf(c)
        })
        .join(', ')
      const count = truncated
        ? `more than ${match.candidates.length}, including`
        : `${match.candidates.length}:`
      return `${noun} ref "${ref}" is ambiguous — it matches ${count} ${list}. Re-run with one of these full ids${truncated ? ' (or a longer ref)' : ''}`
    }
  }
}
