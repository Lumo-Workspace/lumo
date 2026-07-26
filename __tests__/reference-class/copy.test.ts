/**
 * LUM-497 — anchor copy.
 *
 * The reflection line must be a QUESTION, never an instruction: an anchor that
 * says "add evidenceRequired" turns into a template the agent applies without
 * thinking (the LUM-461/485 self-credit inflation shape). A question makes it
 * reason about this task instead.
 */
import {
  REJECTION_LABELS,
  CROSSING_LABELS,
  REJECTION_PROMPTS,
  CROSSING_PROMPTS,
  labelFor,
  selectReflectionPrompt,
} from '@/lib/reference-class'

describe('copy maps', () => {
  it('every reflection prompt is a question, not an instruction', () => {
    for (const text of [
      ...Object.values(REJECTION_PROMPTS),
      ...Object.values(CROSSING_PROMPTS),
    ]) {
      expect(text.endsWith('?')).toBe(true)
      // Scan the WHOLE string, not just the start: every prompt opens with
      // "Tasks here…"/"Send-backs here…", so an anchor to the start can never
      // fire. The directive shape this guards against (LUM-497 Finding 1) put
      // its instruction mid-string, after an em dash — e.g. "should one of
      // your criteria assert that none are?".
      expect(text).not.toMatch(
        /\b(add|make sure|you should|ensure|should|must|assert|noted)\b/i
      )
    }
  })

  it('every label is a non-empty human phrase, not the raw enum', () => {
    for (const [key, label] of [
      ...Object.entries(REJECTION_LABELS),
      ...Object.entries(CROSSING_LABELS),
    ]) {
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toBe(key)
    }
  })

  it('falls back to the raw key for an unmapped value', () => {
    expect(labelFor(REJECTION_LABELS, 'NOT_A_REAL_KEY')).toBe('NOT_A_REAL_KEY')
  })
})

describe('selectReflectionPrompt', () => {
  it('prefers the top send-back reason', () => {
    const out = selectReflectionPrompt(
      [{ key: 'EVIDENCE_INSUFFICIENT', count: 5 }],
      [{ key: 'TEST_TAMPERING', count: 9 }]
    )
    expect(out).toBe(REJECTION_PROMPTS.EVIDENCE_INSUFFICIENT)
  })

  it('falls back to the top crossing when there are no send-backs', () => {
    const out = selectReflectionPrompt(
      [],
      [{ key: 'TEST_TAMPERING', count: 3 }]
    )
    expect(out).toBe(CROSSING_PROMPTS.TEST_TAMPERING)
  })

  it('returns null when both signals are empty', () => {
    expect(selectReflectionPrompt([], [])).toBeNull()
  })

  it('returns null for a key with no mapped prompt', () => {
    expect(
      selectReflectionPrompt([{ key: 'MADE_UP', count: 2 }], [])
    ).toBeNull()
  })
})
