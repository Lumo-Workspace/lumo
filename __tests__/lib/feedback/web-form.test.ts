import {
  FEEDBACK_SCREENSHOT_MAX_MB,
  FEEDBACK_SCREENSHOT_TYPES,
  checkScreenshots,
  toFeedbackInput,
} from '@/lib/feedback/web-form'
import {
  FEEDBACK_EVIDENCE_MAX_BYTES,
  MAX_FEEDBACK_EVIDENCE_FILES,
  createFeedbackPayloadSchema,
} from '@/lib/validation/feedback'

function fileOf(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('LUM-1287 web feedback form — screenshots', () => {
  it('offers only the image types the server accepts', () => {
    expect(FEEDBACK_SCREENSHOT_TYPES).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ])
    expect(FEEDBACK_SCREENSHOT_MAX_MB).toBe(4)
  })

  it('accepts no files, and images within the limits', () => {
    expect(checkScreenshots([])).toBeNull()
    expect(
      checkScreenshots([
        fileOf('a.png', 'image/png', 1000),
        fileOf('b.jpg', 'image/jpeg', FEEDBACK_EVIDENCE_MAX_BYTES),
      ])
    ).toBeNull()
  })

  it('refuses more files than the server allows', () => {
    const files = Array.from(
      { length: MAX_FEEDBACK_EVIDENCE_FILES + 1 },
      (_, i) => fileOf(`${i}.png`, 'image/png', 10)
    )
    expect(checkScreenshots(files)).toEqual({
      code: 'tooMany',
      max: MAX_FEEDBACK_EVIDENCE_FILES,
    })
  })

  it('refuses a file over the size limit, naming it', () => {
    expect(
      checkScreenshots([
        fileOf('big.png', 'image/png', FEEDBACK_EVIDENCE_MAX_BYTES + 1),
      ])
    ).toEqual({ code: 'tooLarge', name: 'big.png', maxMb: 4 })
  })

  it('refuses a non-image file even when the server would take it', () => {
    expect(checkScreenshots([fileOf('log.txt', 'text/plain', 10)])).toEqual({
      code: 'type',
      name: 'log.txt',
    })
  })
})

describe('LUM-1287 web feedback form — payload', () => {
  const blank = { title: '', actual: '', expected: '', details: '' }

  it('sends a bug as trimmed title + actual + expected', () => {
    const input = toFeedbackInput({
      ...blank,
      kind: 'BUG',
      title: '  Board view crashes  ',
      actual: ' It crashed ',
      expected: 'It loads',
      details: 'ignored for a bug',
    })
    expect(input).toEqual({
      kind: 'BUG',
      title: 'Board view crashes',
      actual: 'It crashed',
      expected: 'It loads',
    })
    expect(createFeedbackPayloadSchema.safeParse(input).success).toBe(true)
  })

  it('sends blank bug fields as null, which the server schema accepts', () => {
    const input = toFeedbackInput({
      ...blank,
      kind: 'BUG',
      title: 'T',
      actual: '   ',
    })
    expect(input).toEqual({
      kind: 'BUG',
      title: 'T',
      actual: null,
      expected: null,
    })
    expect(createFeedbackPayloadSchema.safeParse(input).success).toBe(true)
  })

  it.each(['IDEA', 'QUESTION'] as const)(
    'stores the details box of a %s as `expected`',
    kind => {
      const input = toFeedbackInput({
        ...blank,
        kind,
        title: 'Dark mode',
        details: ' Please add it ',
        actual: 'not sent',
      })
      expect(input).toEqual({
        kind,
        title: 'Dark mode',
        expected: 'Please add it',
      })
      expect(createFeedbackPayloadSchema.safeParse(input).success).toBe(true)
    }
  )
})
