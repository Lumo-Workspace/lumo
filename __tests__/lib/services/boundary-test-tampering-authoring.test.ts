/**
 * LUM-449 — TEST_TAMPERING authoring gate (data-gated denoise of LUM-441/455).
 *
 * Measure-first finding. The read-only false-positive harness
 * (`scripts/boundary-fp-rate.ts`) measured TEST_TAMPERING at 100% false-positive
 * over 12 human dispositions (≥ the sample floor) — the noisiest category by a
 * wide margin, and the noise PERSISTED after the LUM-455 precision gate (the
 * dispositions were re-evaluated under it and still ruled FALSE_POSITIVE). Every
 * one of the 12 was the same shape: an agent authoring its OWN task's acceptance
 * test during TDD — a Write creating the test file, or a substantive edit
 * building it up — on a criterion that had not yet passed.
 *
 * The cut. You cannot reward-hack by weakening a test that was never green:
 * test-tampering is only a genuine signal once the backing MACHINE criterion has
 * already PASSED at least once (the "keep the metric green by editing the test"
 * window). Before the first PASS, an edit to the backing test is authoring, not
 * weakening. This mirrors LUM-438, which refined the sibling checkpointer-drift
 * detector the same way (a zero-match is real drift only once the criterion
 * `everPassed`). So a hit is suppressed when the matched criterion has never
 * passed, and still fires once it has.
 *
 * Documented residual hole (the conservative direction is preserved for the
 * threat that matters): an agent that GUTS a never-passed test to force its very
 * first PASS is no longer flagged here. That is the accepted cost of removing
 * 100%-FP authoring noise — the first PASS is itself a recorded verify artifact,
 * and the per-category FP/TP harness now monitors this category for regression.
 * The high-value catch (re-gaming a previously-green check) is untouched.
 */
import { detectTestTampering } from '@/lib/services/boundary-detector.service'

const CHECKPOINTER =
  "npx tsx scripts/jest-t.ts 'the widget renders' __tests__/widget.test.ts"
const FILE = '/Users/dev/repo/__tests__/widget.test.ts'

/** A matched MACHINE checkpointer carrying its prior-pass signal. */
const cp = (everPassed: boolean) => [
  {
    criterionId: 'crit-1',
    statement: 'the widget renders',
    checkpointer: CHECKPOINTER,
    everPassed,
  },
]

/** A substantive Edit that WEAKENS an assertion (the real reward-hacking shape). */
const weakenEdit = {
  toolName: 'Edit' as const,
  filePath: FILE,
  payload: {
    tool_input: {
      file_path: FILE,
      old_string: 'expect(result).toBe(6)',
      new_string: 'expect(result).toBeDefined()',
    },
  },
}

/** A Write that creates the test file wholesale (the dominant FP shape: 5/12). */
const createWrite = {
  toolName: 'Write' as const,
  filePath: FILE,
  payload: {
    tool_input: {
      file_path: FILE,
      content:
        "it('the widget renders', () => { expect(render()).toBeTruthy() })",
    },
  },
}

describe('TEST_TAMPERING authoring gate (LUM-449)', () => {
  it('the false-positive shape no longer fires while a true positive still does', () => {
    // ── False-positive shape (the measured noise): authoring a test for a
    // criterion that has NEVER passed. Both a fresh Write and a substantive
    // edit are now suppressed — there is no green metric to be gaming.
    expect(
      detectTestTampering({ ...createWrite, machineCheckpointers: cp(false) })
    ).toBeNull()
    expect(
      detectTestTampering({ ...weakenEdit, machineCheckpointers: cp(false) })
    ).toBeNull()

    // ── True positive (still caught): the SAME assertion-weakening edit, but on
    // a criterion that has already PASSED — i.e. the test was green and the edit
    // weakens it. This is the reward-hacking window the gate must never hide.
    expect(
      detectTestTampering({ ...weakenEdit, machineCheckpointers: cp(true) })
    ).toMatchObject({
      category: 'TEST_TAMPERING',
    })
    // A wholesale Write over a once-green test is likewise still flagged.
    expect(
      detectTestTampering({ ...createWrite, machineCheckpointers: cp(true) })
    ).toMatchObject({
      category: 'TEST_TAMPERING',
    })
  })

  it('an absent prior-pass signal defaults to flagging (the safe direction)', () => {
    // A checkpointer with no everPassed field (legacy callers) is treated as
    // "assume green" → still flagged on a substantive edit. Only an explicit
    // everPassed:false suppresses. Suppression is opt-in, never silent.
    expect(
      detectTestTampering({
        ...weakenEdit,
        machineCheckpointers: [
          { criterionId: 'c', checkpointer: CHECKPOINTER },
        ],
      })
    ).toMatchObject({ category: 'TEST_TAMPERING' })
  })
})
