import { sanitizeField } from './sanitize'

/**
 * LUM-1230: pick a milestone by what a person types — its slug (the segment
 * the web URL uses, `/milestones/<slug>`), its name, or its id (old scripts).
 * Names are not unique, and a slug is unique only within one project: more
 * than one hit is an error listing the candidates by slug — never a silent
 * pick.
 */

export interface MilestoneLike {
  id: string
  name: string
  /** Absent on an older server; then only id and name match. */
  slug?: string | null
  projectId?: string
}

export type MilestoneMatch<T extends MilestoneLike> =
  | { kind: 'found'; milestone: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'not-found' }

/**
 * Pure: id exact → else the slug typed exactly as the web URL prints it →
 * else every case-insensitive slug or name match. An exact slug wins
 * outright because a slug is the unique handle within a project — `beta`
 * picks the milestone whose slug is `beta` even when two milestones are both
 * *named* "Beta". Anything looser (`Beta`, `HEADLESS-WEB-CLI`) pools slug and
 * name hits: one hit is found, more than one (a reused name, one slug in two
 * projects) is ambiguous.
 */
export function matchMilestoneRef<T extends MilestoneLike>(
  ref: string,
  milestones: readonly T[]
): MilestoneMatch<T> {
  const raw = ref.trim()
  const byId = milestones.find(m => m.id === raw)
  if (byId) return { kind: 'found', milestone: byId }
  const exactSlug = milestones.filter(m => m.slug != null && m.slug === raw)
  if (exactSlug.length === 1) return { kind: 'found', milestone: exactSlug[0]! }
  const needle = raw.toLowerCase()
  const hits =
    exactSlug.length > 1
      ? exactSlug
      : milestones.filter(
          m =>
            (m.slug != null && m.slug.toLowerCase() === needle) ||
            m.name.toLowerCase() === needle
        )
  if (hits.length === 0) return { kind: 'not-found' }
  if (hits.length === 1) return { kind: 'found', milestone: hits[0]! }
  return { kind: 'ambiguous', candidates: hits }
}

/** How a milestone is named in output: its slug, else its name. */
export function milestoneHandle(m: MilestoneLike): string {
  return m.slug && m.slug.length > 0 ? m.slug : m.name
}

/**
 * The ambiguity error: every candidate as `<slug> ("<name>")`. When two
 * candidates share a slug they live in different projects, so the hint asks
 * for `--project` as well.
 */
export function ambiguousMilestoneError(
  ref: string,
  candidates: readonly MilestoneLike[]
): string {
  const list = candidates
    .map(c => sanitizeField(`${milestoneHandle(c)} ("${c.name}")`))
    .join(', ')
  const handles = candidates.map(milestoneHandle)
  const slugClash = new Set(handles).size < handles.length
  const hint = slugClash
    ? 're-run with --project <slug> to pick the project, plus the milestone slug'
    : 're-run with one of these slugs'
  return `ambiguous milestone "${sanitizeField(ref)}" matches ${candidates.length} milestones: ${list}; ${hint}`
}
