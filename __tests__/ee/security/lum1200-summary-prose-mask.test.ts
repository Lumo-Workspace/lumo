/**
 * @jest-environment node
 *
 * LUM-1200 — the PR summary is model-written prose. Production (probe PR 51,
 * summary comment 6192504059): "Adds probe files marked 'do not merge' …"
 * reached the PR as "marked 'do n…(len 12)'" — the blanket quoted-span pass
 * (`maskQuotedValues`, via `redactKnownSecrets`) masked an ordinary quoted
 * phrase as if it were a credential. Real secrets must still be masked.
 */
import {
  cleanPrSummary,
  parsePrSummary,
} from '@/ee/security/security-scan/pr-summary'
import { maskQuotedKeyedValues } from '@/lib/security-scan/redact'

describe('LUM-1200 PR summary keeps quoted prose intact', () => {
  it('renders an ordinary quoted phrase unchanged (production: do not merge)', () => {
    const intent =
      "Adds probe files marked 'do not merge' with a logging helper and a settings store."
    const out = cleanPrSummary({
      intent,
      changes: ['Labels the PR "work in progress" until review'],
    })
    expect(out?.intent).toBe(intent)
    expect(out?.changes).toEqual([
      'Labels the PR "work in progress" until review',
    ])
  })

  it('keeps the phrase when the sentence also talks about tokens (no key before the quote)', () => {
    const intent =
      "Rotates the session token on login and marks the probe 'do not merge'."
    expect(cleanPrSummary({ intent, changes: [] })?.intent).toBe(intent)
  })

  it('still masks a credential-shaped quoted value', () => {
    const out = cleanPrSummary({
      intent: "Hardcodes 'Zx9Qw3Lp7Vb2Nm5Rt8Ky' as the default value.",
      changes: [],
    })
    expect(out?.intent).not.toContain('Zx9Qw3Lp7Vb2Nm5Rt8Ky')
    expect(out?.intent).toContain("'Zx9Q…(len 20)'")
  })

  it('still masks a quoted value that follows a credential key, whatever its shape', () => {
    const out = cleanPrSummary({
      intent: 'Sets the admin password to "correct horse battery staple".',
      changes: [],
    })
    // The keyed rule, not the registry: the value has no secret shape.
    expect(out?.intent).toBe('Sets the admin password to "corr…(len 28)".')
  })

  it('still masks a registry secret written unquoted', () => {
    // Assembled at runtime so the fixture is not itself a key-shaped literal.
    const key = ['AKIA', 'IOSFODNN7', 'EXAMPLF'].join('')
    const out = cleanPrSummary({
      intent: `Adds the key ${key} to the deploy script.`,
      changes: [],
    })
    expect(out?.intent).not.toContain(key)
  })

  it('is idempotent: the read-time pass leaves a written summary as it is', () => {
    const written = cleanPrSummary({
      intent:
        "Marks the probe 'do not merge' and sets token = 'hunter2hunter2'.",
      changes: [],
    })
    expect(written?.intent).toContain("'do not merge'")
    expect(written?.intent).not.toContain('hunter2hunter2')
    expect(parsePrSummary(written)).toEqual(written)
  })
})

describe('maskQuotedKeyedValues', () => {
  it.each([
    ["marked 'do not merge' for now", "marked 'do not merge' for now"],
    ['the "Verification" label', 'the "Verification" label'],
    ["the row's placeholder text", "the row's placeholder text"],
  ])('keeps prose: %s', (input, expected) => {
    expect(maskQuotedKeyedValues(input)).toBe(expected)
  })

  it.each([
    [
      'password is "correct horse battery staple"',
      'password is "corr…(len 28)"',
    ],
    ["token: 'plainwordsecret'", "token: 'plai…(len 15)'"],
    ['the secret "openSesameDoor"', 'the secret "open…(len 14)"'],
    ['{"password": "letmeinplease"}', '{"password": "letm…(len 13)"}'],
    ["{'api_key': 'letmeinplease'}", "{'api_key': 'letm…(len 13)'}"],
    ["const x = 'Zx9Qw3Lp7Vb2Nm5Rt8Ky'", "const x = 'Zx9Q…(len 20)'"],
  ])('masks a keyed or credential-shaped value: %s', (input, expected) => {
    expect(maskQuotedKeyedValues(input)).toBe(expected)
  })

  it('still fails closed on an unpaired opener', () => {
    expect(maskQuotedKeyedValues("note: 'unterminated tail here")).toBe(
      "note: 'unte…(len 22)"
    )
  })
})
