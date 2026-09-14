/**
 * LUM-463 Stage 1 — deterministic context pre-filter for TEST_TAMPERING.
 *
 * After the LUM-455 cosmetic/additive gate and the LUM-449 authoring gate have
 * dropped the obvious noise, a TEST_TAMPERING hit is still raised for ANY
 * substantive edit to an already-green test — but a substantive edit can be
 * perfectly legitimate (requirements/conditions changed, the test SHOULD move).
 * This pre-filter classifies the two clear ends cheaply, with NO LLM call, so
 * the expensive judge (Stage 2) only ever sees the genuinely ambiguous residual:
 *
 *   - signal A — was production (non-test) code co-changed in the same
 *     change-set? co-change leans legit; test-only is the classic reward-hack
 *     shape. `null` means the signal could not be computed (see the safety note).
 *   - signal B — did the edit WEAKEN the assertions (remove one, loosen a
 *     matcher, delete a test case, skip a test)? weakening leans suspicious; a
 *     value-only change with strength preserved leans legit.
 *   - signal C — was the backing acceptance criterion itself edited? a moved
 *     spec is a legitimate reason for the test to move.
 *
 * Safety property (criterion 3): a downgrade is only ever declared on POSITIVE
 * legit evidence (B says not-weakened AND a legit reason A/C is present). An
 * absent or uncomputable signal (`productionCodeCoChanged === null`) can never
 * produce a downgrade — it falls to AMBIGUOUS, where the conservative Stage-2
 * fallback keeps it flagged. Pure, no I/O.
 */

export type PrefilterClassification = 'LEGIT' | 'WEAKENING' | 'AMBIGUOUS'

export interface PrefilterInput {
  /** Edit before side (null for a Write — nothing to diff against). */
  oldString: string | null
  /** Edit after side (Write `content` lands here). */
  newString: string | null
  /**
   * Signal A: did the task's current change-set touch production (non-test)
   * source? `true` = mixed (leans legit), `false` = test-only (leans suspicious),
   * `null` = could not be computed (treated as "no positive legit evidence").
   */
  productionCodeCoChanged: boolean | null
  /** Signal C: was the backing criterion itself edited (CRITERION_CHANGED)? */
  backingCriterionChanged: boolean
}

// --- signal B: assertion-strength analysis -----------------------------------

/** Count non-overlapping occurrences of a global regex. */
function count(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}

const EXPECT_RE = /\bexpect\s*\(/g
const TEST_CASE_RE = /\b(?:it|test)\s*(?:\.\s*(?:only|each)\s*)?\(/g
// Disabling a test is a weakening of coverage.
const SKIP_RE =
  /\b(?:x(?:it|test|describe)|(?:it|test|describe)\s*\.\s*(?:skip|todo))\b/g

// Strong matchers assert a specific value/behavior; weak matchers assert mere
// presence/shape. A strong→weak swap loosens the assertion.
const STRONG_MATCHER_RE =
  /\.\s*(?:toBe|toEqual|toStrictEqual|toMatchObject|toMatch|toContain|toContainEqual|toHaveLength|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveBeenNthCalledWith|toThrow|toThrowError|toBeCloseTo|toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual|toBeInstanceOf)\b/g
const WEAK_MATCHER_RE =
  /\.\s*(?:toBeDefined|toBeUndefined|toBeNull|toBeTruthy|toBeFalsy|toBeNaN|toBeenCalled|toHaveBeenCalled)\b|\.\s*not\s*\.\s*toThrow\b|\bexpect\.\s*anything\b/g

/**
 * Did an edit WEAKEN the test? True when the after side asserts strictly LESS
 * than the before side — fewer `expect(` calls, fewer test cases, a strong
 * matcher swapped for a weak one, or a newly-skipped/`todo` test. A value-only
 * change (same matcher, same counts) is NOT weakening. A missing before side (a
 * Write) cannot be diffed, so it is never asserted as weakened here (the caller's
 * conservative default keeps such an edit flagged via the AMBIGUOUS path).
 */
export function assertionsWeakened(
  oldString: string | null,
  newString: string | null
): boolean {
  if (oldString == null || newString == null) return false

  if (count(newString, EXPECT_RE) < count(oldString, EXPECT_RE)) return true
  if (count(newString, TEST_CASE_RE) < count(oldString, TEST_CASE_RE))
    return true
  if (count(newString, SKIP_RE) > count(oldString, SKIP_RE)) return true

  const strongBefore = count(oldString, STRONG_MATCHER_RE)
  const strongAfter = count(newString, STRONG_MATCHER_RE)
  const weakBefore = count(oldString, WEAK_MATCHER_RE)
  const weakAfter = count(newString, WEAK_MATCHER_RE)
  // A strong matcher disappeared while a weak one appeared → loosened.
  if (strongAfter < strongBefore && weakAfter > weakBefore) return true

  return false
}

/**
 * Deterministic Stage-1 classification. LEGIT and WEAKENING are the CLEAR ends
 * the LLM never needs to see; AMBIGUOUS is the residual handed to Stage 2.
 */
export function classifyTestTamperingPrefilter(
  input: PrefilterInput
): PrefilterClassification {
  const weakened = assertionsWeakened(input.oldString, input.newString)
  // A legit reason must be POSITIVE evidence — `null` (uncomputable) is not.
  const legitReason =
    input.productionCodeCoChanged === true || input.backingCriterionChanged
  // LUM-771: a Write has no before side, so "not weakened" is NOT evidence —
  // `assertionsWeakened` simply could not look. A full-file rewrite must never
  // clear Stage 1 on its own; it always goes to Stage 2 as AMBIGUOUS.
  const diffable = input.oldString != null

  if (diffable && !weakened && legitReason) return 'LEGIT'
  if (weakened && !legitReason) return 'WEAKENING'
  return 'AMBIGUOUS'
}
