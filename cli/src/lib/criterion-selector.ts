/**
 * LUM-815: resolve a criterion selector — a full id, or a ≥6-char unique id
 * prefix — against a list of criteria.
 *
 * Extracted from `milestone-criteria-verdict.ts` when `task testcase
 * add/update --criterion` needed the same resolution against a **task's**
 * acceptance contract. The only thing that differs between the two call sites
 * is which `list` command the error message should point at, so that is the
 * one parameter; the matching rules are identical on purpose (a selector that
 * works in one place should not silently mean something else in the other).
 *
 * Pure — no network, no I/O. Ambiguous and unknown selectors fail with the
 * candidates spelled out rather than picking one.
 */
export type CriterionSelectorResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export function resolveCriterionRef(
  selector: string,
  criteria: Array<{ id: string; statement: string }>,
  listCommand: string
): CriterionSelectorResult {
  const exact = criteria.find(c => c.id === selector)
  if (exact) return { ok: true, id: exact.id }
  if (selector.length < 6) {
    return {
      ok: false,
      error: `criterion selector "${selector}" is too short — pass the id (or a prefix of at least 6 chars) from \`${listCommand}\``,
    }
  }
  const hits = criteria.filter(c => c.id.startsWith(selector))
  if (hits.length === 1) return { ok: true, id: hits[0]!.id }
  if (hits.length === 0) {
    return {
      ok: false,
      error: `no criterion matches "${selector}" — see \`${listCommand}\``,
    }
  }
  const candidates = hits
    .map(h => `  ${h.id}  ${h.statement.slice(0, 60)}`)
    .join('\n')
  return {
    ok: false,
    error: `ambiguous selector "${selector}" matches ${hits.length} criteria:\n${candidates}`,
  }
}
