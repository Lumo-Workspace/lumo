/** @jest-environment node */
/**
 * LUM-1064: plugin half of __tests__/security-scan/secret-coverage-lum887.test.ts (split)
 */
// `@octokit/auth-app` is ESM-only and the sandbox module imports it transitively.
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))

import {
  redactForInjection,
  redactForStorage,
  redactKnownSecrets,
  scanSecrets,
} from '@/lib/security-scan/scan-secrets'
import { redactHookPayload } from '@/lib/validation/hook-payload'
import { sanitizeHuntOutput } from '@/lib/services/security-hunt-sandbox'

// Every credential-shaped value below is assembled at runtime from a seeded
// generator and split prefixes, so no literal in this file looks like a real
// credential (team convention: never hardcode credential-shaped fixtures).

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const B64 = ALNUM + '+/'
const HEX = '0123456789abcdef'

function gen(alphabet: string, len: number, seed: number): string {
  let x = seed >>> 0 || 1
  let out = ''
  for (let i = 0; i < len; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    out += alphabet[(x >>> 8) % alphabet.length]
  }
  return out
}

const DASHES = '-'.repeat(5)
const begin = (label: string) => `${DASHES}BEGIN ${label}${DASHES}`
const end = (label: string) => `${DASHES}END ${label}${DASHES}`
const bodyLines = (seed: number, n = 4) =>
  Array.from({ length: n }, (_, i) => gen(B64, 64, seed + i))

const LABELS = [
  'RSA PRIVATE KEY',
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
  'EC PRIVATE KEY',
  'PGP PRIVATE KEY BLOCK',
]

type EntryPoint = [string, (text: string) => string]

const ENTRY_POINTS: EntryPoint[] = [
  ['redactForStorage', t => redactForStorage(t).text],
  [
    'redactHookPayload',
    t => {
      const { payload } = redactHookPayload({ tool_input: { content: t } })
      return (payload.tool_input as { content: string }).content
    },
  ],
  ['redactForInjection', t => redactForInjection(t).text],
  ['redactKnownSecrets', t => redactKnownSecrets(t)],
  ['sanitizeHuntOutput', t => sanitizeHuntOutput(t, '')],
]

describe('LUM-887 private key blocks', () => {
  test('LUM-887 private key block body never survives any redaction entry point', () => {
    let seed = 100
    for (const label of LABELS) {
      const body = bodyLines(seed)
      seed += 10
      const forms: Record<string, string> = {
        multiline: [begin(label), ...body, end(label)].join('\n'),
        crlf: [begin(label), ...body, end(label)].join('\r\n'),
        jsonEscaped: [begin(label), ...body, end(label)].join('\\n'),
        spaceFlattened: [begin(label), ...body, end(label)].join(' '),
      }
      for (const [form, block] of Object.entries(forms)) {
        const text = `before the key\n${block}\nafter the key`
        for (const [name, redact] of ENTRY_POINTS) {
          const out = redact(text)
          const where = `${name} / ${label} / ${form}`
          for (const line of body)
            expect([where, out.includes(line)]).toEqual([where, false])
          expect([where, out.includes(end(label))]).toEqual([where, false])
          expect([where, out.includes('before the key')]).toEqual([where, true])
          expect([where, out.includes('after the key')]).toEqual([where, true])
        }
      }
    }
  })
})

describe('LUM-887 truncated private key blocks', () => {
  test('LUM-887 truncated private key block body is redacted', () => {
    const label = 'RSA PRIVATE KEY'
    const body = bodyLines(300, 3)
    const partial = gen(B64, 21, 999) // a line cut mid-way by a cap
    const cases = [
      // cut at a cap: the text simply ends mid-body
      [begin(label), ...body, partial].join('\n'),
      // `head -n 4 key.pem; echo done` style: body then unrelated output
      [begin(label), ...body, 'next command output here'].join('\n'),
      // legacy encrypted PEM headers + blank line before the body
      [
        begin(label),
        'Proc-Type: 4,ENCRYPTED',
        'DEK-Info: AES-128-CBC,' + gen(HEX, 32, 5).toUpperCase(),
        '',
        ...body,
        'next command output here',
      ].join('\n'),
      // JSON-escaped, cut at a cap
      [begin(label), ...body, partial].join('\\n'),
    ]
    for (const text of cases) {
      for (const [name, redact] of ENTRY_POINTS) {
        const out = redact(`$ cat key.pem\n${text}`)
        for (const line of [...body, partial])
          expect([name, text, out.includes(line)]).toEqual([name, text, false])
        expect([name, out.includes('$ cat key.pem')]).toEqual([name, true])
        if (text.includes('next command output here'))
          expect([name, out.includes('next command output here')]).toEqual([
            name,
            true,
          ])
      }
    }
  })
})

describe('LUM-887 unquoted and unprefixed credential shapes', () => {
  const pw = gen(ALNUM, 6, 11) + '#' + gen(ALNUM, 7, 12)
  const opaque = gen(ALNUM + '-_.', 40, 13)
  const cases: { rule: string; line: string; value: string }[] = [
    {
      rule: 'env-assignment',
      line: 'DATABASE_PASSWORD=' + pw,
      value: pw,
    },
    {
      rule: 'env-assignment',
      line: 'export OPENAI_API' + '_KEY=' + gen(ALNUM, 30, 14),
      value: gen(ALNUM, 30, 14),
    },
    {
      rule: 'env-assignment',
      line: 'PGPASSWORD=' + pw + ' psql -h db.internal -U app',
      value: pw,
    },
    {
      rule: 'env-assignment',
      line: 'CLERK_SECRET_KEY="' + gen(ALNUM, 12, 15) + '"',
      value: gen(ALNUM, 12, 15),
    },
    {
      rule: 'http-authorization',
      line: `curl -H "Authorization: Bearer ${opaque}" https://api.example.com`,
      value: opaque,
    },
    {
      rule: 'http-authorization',
      line: 'Authorization: Basic ' + gen(B64, 24, 16),
      value: gen(B64, 24, 16),
    },
    {
      rule: 'bearer-token',
      line: 'sent header Bearer ' + gen(ALNUM, 32, 17) + ' to upstream',
      value: gen(ALNUM, 32, 17),
    },
    {
      rule: 'cli-credential-flag',
      line: 'mysqladmin --password ' + pw + ' status',
      value: pw,
    },
    {
      rule: 'cli-credential-flag',
      line: 'vercel deploy --prod --token=' + gen(ALNUM, 24, 18),
      value: gen(ALNUM, 24, 18),
    },
    {
      rule: 'stripe-clerk-test-key',
      line: 'key: ' + 'sk_' + 'test_' + gen(ALNUM, 40, 19),
      value: 'sk_' + 'test_' + gen(ALNUM, 40, 19),
    },
    {
      rule: 'stripe-clerk-test-key',
      line: 'key: ' + 'rk_' + 'test_' + gen(ALNUM, 24, 20),
      value: 'rk_' + 'test_' + gen(ALNUM, 24, 20),
    },
    {
      rule: 'npm-token',
      line: '//registry.npmjs.org/:_authToken=' + 'npm_' + gen(ALNUM, 36, 21),
      value: 'npm_' + gen(ALNUM, 36, 21),
    },
    {
      rule: 'gitlab-pat',
      line:
        'git clone https://oauth2:' +
        'glpat-' +
        gen(ALNUM, 20, 22) +
        '@gitlab.com/x/y',
      value: 'glpat-' + gen(ALNUM, 20, 22),
    },
    {
      rule: 'huggingface-token',
      line: 'login(' + 'hf_' + gen(ALNUM, 34, 23) + ')',
      value: 'hf_' + gen(ALNUM, 34, 23),
    },
    {
      rule: 'lumo-api-key',
      line: 'lumo auth login ' + 'lum_' + gen(HEX, 64, 24),
      value: 'lum_' + gen(HEX, 64, 24),
    },
    {
      rule: 'vercel-blob-token',
      line:
        'blob token ' +
        'vercel_blob_rw_' +
        gen(ALNUM, 16, 25) +
        '_' +
        gen(ALNUM, 30, 26),
      value: 'vercel_blob_rw_' + gen(ALNUM, 16, 25) + '_' + gen(ALNUM, 30, 26),
    },
  ]

  test('LUM-887 previously missed credential shapes are redacted', () => {
    for (const c of cases) {
      const outputs = {
        storage: redactForStorage(c.line).text,
        injection: redactForInjection(c.line).text,
        known: redactKnownSecrets(c.line),
        hunt: sanitizeHuntOutput(c.line, ''),
      }
      for (const [name, out] of Object.entries(outputs))
        expect([c.rule, name, out.includes(c.value)]).toEqual([
          c.rule,
          name,
          false,
        ])
      const found = scanSecrets([
        { path: 'src/app.ts', lines: [{ lineNo: 1, text: c.line }] },
      ])
      expect([c.line, found.length]).toEqual([c.line, 1])
      expect(found[0]!.evidence.includes(c.value)).toBe(false)
    }
    // A whole .env file stored by the hook pipeline.
    const envFile = cases
      .filter(c => c.rule === 'env-assignment')
      .map(c => c.line)
      .join('\n')
    const stored = JSON.stringify(
      redactHookPayload({ tool_input: { file_path: '.env', content: envFile } })
        .payload
    )
    for (const c of cases.filter(c => c.rule === 'env-assignment'))
      expect(stored.includes(c.value)).toBe(false)
  })
})
