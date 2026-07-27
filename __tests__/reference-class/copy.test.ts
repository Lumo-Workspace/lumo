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

/**
 * Phrase-level markers of a directive. LUM-707 item 2 narrowed these from a
 * bare word list (`should|must|assert|noted`, scanned over the whole string):
 * those words are ordinary vocabulary in a legitimate question — "what must be
 * true for this to pass?" — and `assert` is this domain's own word, since every
 * checkpointer asserts. The wide list had already bent the product: a fix round
 * reworded NEW_NPM_DEPENDENCY from "add one" to "introduce one" purely to get
 * past it. A guard that forces evasive wording is measuring the wrong thing.
 *
 * What actually distinguishes a directive is its SHAPE, so each marker is
 * anchored:
 *  - an imperative verb opening a CLAUSE (string start, or after an em dash /
 *    sentence punctuation) — where an instruction naturally begins. The same
 *    verb mid-clause ("does this change add one?") is just a question.
 *  - `you should` / `you must` — telling the reader what to do, unlike a bare
 *    `should` inside a question.
 *  - `assert that` / `is noted` — the two phrases the observed directives used.
 *
 * Clause anchoring, not string-start anchoring: the shape this guards against
 * (LUM-497 Finding 1) put its instruction mid-string, after an em dash — "…
 * deleted migration files — should one of your criteria assert that none are?".
 */
const DIRECTIVE_MARKERS: RegExp[] = [
  /(^|[—.;:]\s*)(add|ensure|make sure|remember to|be sure to)\b/i,
  /\byou (should|must)\b/i,
  /\bassert that\b/i,
  /\bis noted\b/i,
]

function directiveMarkers(text: string): string[] {
  return DIRECTIVE_MARKERS.filter(re => re.test(text)).map(re => re.source)
}

describe('directive guard', () => {
  it('every reflection prompt is a question, not an instruction', () => {
    for (const text of [
      ...Object.values(REJECTION_PROMPTS),
      ...Object.values(CROSSING_PROMPTS),
    ]) {
      expect(text.endsWith('?')).toBe(true)
      expect(directiveMarkers(text)).toEqual([])
    }
  })

  // The regression the guard exists for. This is the prompt LUM-497 shipped and
  // then fixed: it named the criterion to write instead of asking a question,
  // turning the anchor into a template the agent applies without thinking.
  // Narrowing the markers must not cost us this catch.
  it('still rejects the directive-shaped prompt it was written for', () => {
    const shipped =
      'Tasks here have deleted migration files — should one of your criteria assert that none are?'
    expect(directiveMarkers(shipped)).not.toEqual([])
  })

  // The false positives that made the old word list distort the copy. Each of
  // these is a genuine question; none tells the reader to do anything.
  it('accepts a genuine question that merely contains bare should, must, assert or noted', () => {
    for (const text of [
      'Tasks here have added npm dependencies — does this change add one, and why is it needed?',
      'Tasks here fail on checks that never ran — what must be true for yours to pass?',
      'Tasks here lean on checkpointers that assert nothing — what does yours actually observe?',
      'Tasks here shipped changes nobody noted — where would a reader see this one?',
      'Tasks here disagree about scope — should this land here or somewhere else?',
    ]) {
      expect(directiveMarkers(text)).toEqual([])
    }
  })
})

describe('copy maps', () => {
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
