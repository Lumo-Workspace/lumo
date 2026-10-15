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
import { redactSummaryText } from '@/lib/security-scan/scan-secrets'

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
    [
      "makes CI pass 'lint and typecheck'",
      "makes CI pass 'lint and typecheck'",
    ],
    ["adds auth 'single sign-on' copy", "adds auth 'single sign-on' copy"],
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
    ["auth: 'letmeinplease'", "auth: 'letm…(len 13)'"],
    ['pass = "letmeinplease"', 'pass = "letm…(len 13)"'],
  ])('masks a keyed or credential-shaped value: %s', (input, expected) => {
    expect(maskQuotedKeyedValues(input)).toBe(expected)
  })

  it('still fails closed on an unpaired opener', () => {
    expect(maskQuotedKeyedValues("note: 'unterminated tail here")).toBe(
      "note: 'unte…(len 22)"
    )
  })
})

// LUM-1200 follow-up #2 — production (probe PR 63): the linked requirement
// `GET /session/check?token=...` rendered as `GET …(len 28)` in the PR
// summary: `token=` read as a credential assignment although its value is a
// placeholder.
describe('a placeholder credential value renders; a real one is masked', () => {
  it.each([
    '`GET /session/check?token=...`',
    '`GET /session/check?token=…`',
    '`GET /session/check?token=<token>`',
    '`curl -H "x" /check?token={token}`',
    '`export API_KEY=${API_KEY}`',
    '`password = "<your password>"`',
    "the token is '<your token here>'",
  ])('keeps %s', input => {
    expect(redactSummaryText(input)).toBe(input)
    expect(maskQuotedKeyedValues(input)).toBe(input)
  })

  it.each([
    ['`GET /session/check?token=correcthorse`', '`GET …(len 37)`'],
    ['`GET /check?token=...&secret=letmeinplease`', '`GET …(len 41)`'],
    ["`const pw = 'correcthorse'`", '`cons…(len 25)`'],
    ['the token is "letmeinplease"', 'the token is "letm…(len 13)"'],
    // A bracket or `$` does not make a value a placeholder unless it names one.
    [
      'the password is "$correct horse battery"',
      'the password is "$cor…(len 22)"',
    ],
    ['`token = "<a> realsecret"`', '`toke…(len 24)`'],
    ['`GET /check?token=<correcthorse>`', '`GET …(len 31)`'],
    ['`export TOKEN=$hunter`', '`expo…(len 20)`'],
  ])('masks %s', (input, expected) => {
    expect(redactSummaryText(input)).toBe(expected)
  })
})

// LUM-1200 follow-up #2 review — the placeholder exemption is read on the
// RAW value and only in its exact shapes; a real-looking value in a
// placeholder-like shape stays masked (fail closed).
describe('adversarial values in placeholder-like shapes stay masked', () => {
  it.each([
    // Split by `-` / `_` / camelCase: never read as the filler `xxx`.
    '`GET /check?token=xxx-realsecretvalue`',
    '`token=xxx_realsecretvalue`',
    '`token=xxxRealSecretValue`',
    '`token=...realsecretvalue`',
    '`token=***realsecretvalue`',
    // Bracketed passphrases that merely contain a credential / filler word.
    '`password = "<correct horse battery token>"`',
    '`password = "<your password is hunter>"`',
    '`token={correct-horse-token}`',
    '`token=<my token value here please>`',
    '`apiKey: ${API_KEY2}`',
    '`token=$correcthorse`',
    // One real value beside a placeholder.
    '`GET /check?token=<token>&secret=letmeinplease`',
  ])('masks %s', input => {
    const out = redactSummaryText(input)
    expect(out).not.toBe(input)
    expect(out).toMatch(/…\(len \d+\)/)
  })

  it('masks a bracketed passphrase after a credential key in prose', () => {
    expect(
      redactSummaryText('the password is "<my correct horse token>"')
    ).toBe('the password is "<my …(len 24)"')
  })

  it.each([
    '`GET /check?token=<your token here>`',
    '`export TOKEN=$SESSION_KEY`',
    '`curl /check?token={{token}}`',
    '`token=xxxx`',
  ])('keeps the exact placeholder shape %s', input => {
    expect(redactSummaryText(input)).toBe(input)
  })
})
