/**
 * LUM-1013 — `redactKnownSecrets` runs over every free-text field an LLM
 * authors (AI-review title / detail / evidence, verifier reason). Its final
 * `maskQuotedValues` pass masked EVERY quoted span of 8+ chars and read a
 * prose apostrophe (`row's`) as an unpaired opener, so ordinary review text
 * reached the Record tab as `The row's ph…(len 364)`. The strings below are
 * shaped on the LUM-1011 / PR 1313 findings.
 */
import { maskQuotedValues } from '@/lib/security-scan/redact'
import {
  redactFindingText,
  redactKnownSecrets,
  scanSecrets,
} from '@/lib/security-scan/scan-secrets'
import type { AddedFile } from '@/lib/security-scan/types'

describe('LUM-1013 — ordinary review prose survives redactFindingText', () => {
  const prose: Array<[string, string]> = [
    [
      'title quoting a UI label',
      "The group heading would be labelled 'Verification' only via aria-label, not visibly",
    ],
    [
      'detail with a possessive apostrophe',
      "The row's phase badge is rendered twice when the run has no steps, so the list reads 'Passed Passed' and screen readers announce it twice.",
    ],
    [
      'verifier reason with a possessive apostrophe',
      "Each group's aria-labelledby points at a heading id that is rendered, so the claim is wrong.",
    ],
    [
      'evidence: a JSX className',
      "<div className='grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-3 py-2 text-sm'>",
    ],
    [
      'evidence: a jest test name',
      "it('test case runs show who ran each run and how far it got', async () => {",
    ],
    [
      'contractions',
      "Don't render it here; it's already shown and we'd duplicate it.",
    ],
  ]

  it.each(prose)('%s is returned verbatim', (_label, text) => {
    expect(redactFindingText(text)).toBe(text)
  })
})

describe('LUM-1013 — real secrets in free text stay redacted', () => {
  const leaks: Array<[string, string, string]> = [
    [
      'AWS key',
      'The key AKIAABCDEFGHIJKLMNOP is committed',
      'AKIAABCDEFGHIJKLMNOP',
    ],
    [
      'quoted AWS key in prose',
      "It hardcodes 'AKIAABCDEFGHIJKLMNOP' in the client",
      'AKIAABCDEFGHIJKLMNOP',
    ],
    [
      'GitHub token',
      'uses ghp_abcdefghijklmnopqrstuvwxyz0123456789 directly',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    ],
    [
      'connection string',
      "connects with 'postgres://app:hunter2secret@db.example.com/app'",
      'hunter2secret',
    ],
    [
      'quoted unknown-shape token, no credential words',
      "The header is set to 'Zx9Qw3Lp7Vb2Nm5Rt8Ky' on every request",
      'Zx9Qw3Lp7Vb2Nm5Rt8Ky',
    ],
    [
      'short mixed letters+digits value, no credential words',
      "The client sends 'hunter2isgood' to the server",
      'hunter2isgood',
    ],
    [
      'quoted passphrase next to credential vocabulary',
      "The committed password is 'correct horse battery staple' in config.",
      'correct horse battery staple',
    ],
    [
      'quoted word value on a pw assignment',
      "The row's fixture sets const pw = 'correcthorsebattery'",
      'correcthorsebattery',
    ],
    [
      'unknown token inside a whitespace-bearing span',
      "fetch(url, { headers: 'Bearer Zx9Qw3Lp7Vb2Nm5Rt8KyAb' })",
      'Zx9Qw3Lp7Vb2Nm5Rt8KyAb',
    ],
    [
      'unterminated quote still masks the tail',
      "The value 'Zx9Qw3Lp7Vb2Nm5Rt8Ky is cut off",
      'Zx9Qw3Lp7Vb2Nm5Rt8Ky',
    ],
  ]

  it.each(leaks)('%s', (_label, text, secret) => {
    const out = redactFindingText(text)
    expect(out).not.toContain(secret)
    expect(out).toContain('…(len')
  })

  it('a bytes-literal prefix is not read as a contraction apostrophe', () => {
    const out = redactFindingText("key = b's-Zx9Qw3Lp7Vb2Nm5Rt8Ky' + 'a' + 'b'")
    expect(out).not.toContain('Zx9Qw3Lp7Vb2Nm5Rt8Ky')
  })
})

describe('LUM-1013 review — key shapes split by punctuation and key vocabulary', () => {
  const leaks: Array<[string, string, string]> = [
    [
      'dashed + base64 key whose runs are pure letters / pure digits',
      "The client sends 'sk-live-abcDEF/ghiJKL+123' on boot",
      'sk-live-abcDEF/ghiJKL+123',
    ],
    [
      'grouped dashed key',
      "It falls back to 'AbCd-1234-EfGh-5678' when unset",
      'AbCd-1234-EfGh-5678',
    ],
    [
      'dashed key wrapped in sentence punctuation inside a span',
      "The default is '(AbCd-1234-EfGh-5678).' here",
      'AbCd-1234-EfGh-5678',
    ],
    [
      'letters-only value next to a credential "… key" compound',
      "The signing key is 'correcthorsebattery' in the fixture",
      'correcthorsebattery',
    ],
    [
      'SSH key compound in camelCase',
      "sshKey defaults to 'correcthorsebattery'",
      'correcthorsebattery',
    ],
  ]

  it.each(leaks)('%s', (_label, text, secret) => {
    const out = redactFindingText(text)
    expect(out).not.toContain(secret)
    expect(out).toContain('…(len')
  })

  it.each([
    "Uses the React key 'Verification' on each row",
    "The class list 'grid grid-cols-[1fr_auto] gap-2 mt-0.5 LUM-1011' is fine",
  ])('identifiers and a bare React "key" stay readable: %s', text => {
    expect(redactFindingText(text)).toBe(text)
  })
})

/**
 * Outputs of the blanket pass captured from origin/main 8a444f1e9 (before
 * LUM-1013). AI-review fingerprints are keyed on this output, so it must not
 * move by a byte, or every human FALSE_POSITIVE stops being inherited.
 */
const LEGACY_BLANKET: Array<[string, string]> = [
  [
    "// the row's badge isn't shown; label = 'Verification'",
    "// the row's ba…(len 11)'t shown; label = 'Veri…(len 12)'",
  ],
  [
    "<div className='grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-3 py-2 text-sm'>",
    "<div className='grid…(len 80)'>",
  ],
  [
    `const msg = "don't" + 'Passed Passed'`,
    `const msg = "don't" + 'Pass…(len 13)'`,
  ],
]

describe('LUM-1013 — scanSecrets evidence keeps the blanket quoted mask', () => {
  it('an undetected quoted word beside a detected key is still masked', () => {
    const f: AddedFile = {
      path: 'src/co.ts',
      lines: [
        {
          lineNo: 1,
          text: 'const k = "AKIAABCDEFGHIJKLMNOP"; const motto = "correcthorsebattery"',
        },
      ],
    }
    const [hit] = scanSecrets([f])
    expect(hit?.evidence).not.toContain('correcthorsebattery')
  })

  it.each(LEGACY_BLANKET)(
    'redactKnownSecrets is byte-identical to main: %s',
    (input, legacy) => {
      expect(redactKnownSecrets(input)).toBe(legacy)
      expect(maskQuotedValues(input)).toBe(legacy)
    }
  )
})
