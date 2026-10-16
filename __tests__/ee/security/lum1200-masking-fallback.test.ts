/**
 * @jest-environment node
 *
 * LUM-1200 follow-up #7 — two masking bugs.
 *
 * A. Production TC19 (lumo-agent-test#72 r11 t3, trace step 8): the hunt
 *    trace prose `` 1. Line 31: `if (url.startsWith('/session/check'))` ``
 *    rendered as `` `if (url.startsWith('/ses…(len 855) `` — a plural
 *    possessive (`users'`) later in the text was an unpaired quote, and the
 *    "ambiguous pairing" fallback masked from the FIRST `'` in the text, which
 *    sat inside a backtick span that had already closed, to the end.
 * B. `redactToolOutputLine` masked a keyed value twice (`SECRET_KEY=djan…(len
 *    9) 48)`): the unquoted-assignment pass read the registry's own
 *    redaction prefix as a fresh 8+ char value.
 * The adversarial half of each block keeps genuinely unclosed quotes and
 * keyed values masked.
 */
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import {
  maskQuotedCodeValues,
  maskQuotedKeyedValues,
  maskQuotedValues,
  redactSecret,
} from '@/lib/security-scan/redact'
import {
  redactSummaryText,
  redactToolOutputLine,
} from '@/lib/security-scan/scan-secrets'

// Built at runtime so no credential-shaped literal sits in the source.
const SHAPED = ['Zx9Qw3Lp', '7Vb2Nm5R', 't8Ky'].join('')
const PASSPHRASE = ['correct', 'horse', 'battery'].join('')
const STRIPE_LIKE = ['sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc'].join('')
const DJANGO_LIKE = ['django', '-insecure-', 'abcdef1234567890abcdef'].join('')
const ROUTE_LINE = "1. Line 31: `if (url.startsWith('/session/check'))`"
const MARKER_RE = /…\(len \d+\)/g

function markers(text: string): string[] {
  return text.match(MARKER_RE) ?? []
}

describe('A. an unpaired apostrophe never masks from inside a closed span', () => {
  it.each([
    // Production trace step (TC19), as the model wrote it.
    `Now I can see the issue! Let me analyze the code carefully:\n\n${ROUTE_LINE} - checks prefix without method\n2. Line 39: \`if (url.startsWith('/session') && method === 'POST')\` - checks method.\n\nThe check route accepts any method.`,
    `${ROUTE_LINE} - checks prefix\n2. The sessions' map never evicts entries, so the attacker's token stays valid.`,
    `${ROUTE_LINE} - the users' tokens are valid.`,
    // Possessive before punctuation and at the end of the text.
    `${ROUTE_LINE} reads the clients'. Then \`'/session/check'\` again.`,
    `${ROUTE_LINE} is checked before the users'`,
  ])('keeps trace prose %#', text => {
    expect(redactSummaryText(text)).toBe(text)
    expect(redactFindingProse(text)).toBe(text)
    expect(maskQuotedKeyedValues(text)).toBe(text)
  })

  it('keeps the route literal when a genuinely unclosed quote follows', () => {
    const text = `${ROUTE_LINE} - the users' token is '${PASSPHRASE} and more`
    const out = redactSummaryText(text)
    expect(out).toContain("startsWith('/session/check')")
    expect(out).not.toContain(PASSPHRASE)
    // The skipped possessive may have been an opener after all: the mask
    // starts there (fail closed), never inside the closed backtick span.
    expect(out).toBe(
      `${ROUTE_LINE} - the users'${redactSecret(` token is '${PASSPHRASE} and more`)}`
    )
  })

  it('code output: a possessive in a comment does not mask the line', () => {
    const line =
      "  // the users' sessions: if (url.startsWith('/session/check'))"
    expect(maskQuotedCodeValues(line)).toBe(line)
    expect(redactToolOutputLine(line)).toBe(line)
  })

  describe('fail closed', () => {
    it.each([
      // An unclosed quote that opens a secret-shaped value.
      [`${ROUTE_LINE} then token '${SHAPED}`, SHAPED],
      [`${ROUTE_LINE} the users' key is '${SHAPED} here`, SHAPED],
      // No backtick span at all: an unclosed value after a possessive.
      [`The admins' password is '${PASSPHRASE}`, PASSPHRASE],
      // A possessive-looking quote right after a quoted credential stays inside it.
      [`the password is '${PASSPHRASE}s' ok`, PASSPHRASE],
    ])('masks %j', (text, secret) => {
      for (const out of [
        redactSummaryText(text),
        redactFindingProse(text),
        redactFindingProse(text, true),
      ]) {
        expect(out).not.toContain(secret)
        expect(markers(out).length).toBeGreaterThan(0)
      }
    })

    it('an apostrophe after a single letter or a string prefix still opens', () => {
      // `b'…` / `x'…` are literal prefixes, not possessives.
      for (const text of [`value b' ${SHAPED}`, `blob rb' ${SHAPED}`]) {
        expect(redactSummaryText(text)).not.toContain(SHAPED)
      }
    })

    it('the blanket evidence pass is unchanged (fingerprints key on it)', () => {
      const text = `${ROUTE_LINE} - the users' tokens are valid.`
      // Byte-identical to the output before this fix.
      expect(maskQuotedValues(text)).toBe(
        "1. Line 31: `if (…(len 19)'/ses…(len 49)"
      )
    })
  })
})

describe('B. tool output masks a keyed value exactly once', () => {
  it.each([
    ['SECRET_KEY=', DJANGO_LIKE],
    ['  api_key: ', STRIPE_LIKE],
    ['JWT_SECRET=', PASSPHRASE],
    ['password: ', ['hunter', '2xyz'].join('')],
    ['export API_KEY=', SHAPED],
  ])('%j', (key, value) => {
    const out = redactToolOutputLine(`${key}${value}`)
    expect(out).toBe(`${key}${redactSecret(value)}`)
    expect(markers(out)).toHaveLength(1)
    expect(out).not.toContain(value)
  })

  it('quoted keyed values are still masked once', () => {
    const out = redactToolOutputLine(`SECRET_KEY='${DJANGO_LIKE}'`)
    expect(out).toBe(`SECRET_KEY='${redactSecret(DJANGO_LIKE)}'`)
  })

  it('fail closed: a value glued to a redaction token is still masked', () => {
    const glued = `token=${redactSecret(SHAPED)}`
    // The marker alone is left as is; nothing new is exposed.
    expect(redactToolOutputLine(glued)).toBe(glued)
    const unmasked = `JWT_SECRET=${PASSPHRASE} other=${STRIPE_LIKE}`
    const out = redactToolOutputLine(unmasked)
    expect(out).not.toContain(PASSPHRASE)
    expect(out).not.toContain(STRIPE_LIKE)
    expect(markers(out)).toHaveLength(2)
  })
})
