/**
 * LUM-1200 follow-up #3 — production TC9 (lumo-agent-test#65): the hunt's
 * shell commands were recorded with their search patterns masked
 * (`rg -A 10 "expo…(len 33)"` was `"export function checkSessionToken"`),
 * because the command pass masked every quoted argument once the command
 * named a credential anywhere, identifiers read word by word. And a fenced
 * code block in hunt trace prose (#66) was masked whole as one quoted span.
 */
import {
  redactShellCommand,
  redactSummaryText,
} from '@/lib/security-scan/scan-secrets'
import { maskQuotedCommandArgs } from '@/lib/security-scan/redact'

// Built at runtime so no credential-shaped literal sits in the source.
const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('')
const SHAPED = ['Zx9Qw3Lp', '7Vb2Nm5R', 't8Ky'].join('')
const RANDOM_LETTERS = ['QwErTyUi', 'OpAsDfGh', 'Jk'].join('')

describe('hunt shell commands keep ordinary search patterns', () => {
  it.each([
    // The #65 shapes (identifiers holding a credential word).
    'rg -A 10 "export function checkSessionToken" src/services/session-store.ts',
    'rg -A 8 "export function checkSessionToken" src/services/session-store.ts',
    'rg -B 5 -A 15 "checkSessionToken(token" src/server.ts',
    'rg -n "checkSessionToken|createSession" src/services/session-store.ts src/server.ts',
    'rg -n "Math.random|SESSION_TOKEN" src/services/session-store.ts',
    'rg -n "function createSession|function findSession|function isSessionValid" src/services/session-store.ts',
    // A credential word as a search term, a path, a flag value.
    'grep -n "session/check|token" src/server.ts',
    'rg -n "token" src/server.ts && rg -n "searchParams" src/server.ts',
    'cat src/lib/token.ts | rg "function verifyToken"',
    "rg -n 'parseQuantity' src/probe",
    'rg -n "startsWith|searchParams|createSession" src/server.ts',
    // A key read, compared or left empty is no assignment of a value.
    'rg -n "token.length > 0" src/services/session-store.ts',
    'rg -n "password ===" src',
    "rg -n 'token=' src",
  ])('keeps %s', cmd => {
    expect(redactShellCommand(cmd)).toBe(cmd)
    expect(maskQuotedCommandArgs(cmd)).toBe(cmd)
  })
})

describe('hunt shell commands still mask secrets (fail closed)', () => {
  it.each([
    // Shape: a generated value, a long random mixed-case run.
    [`rg -n '${SHAPED}' src`, "rg -n 'Zx9Q…(len 20)' src"],
    [`rg -n "${RANDOM_LETTERS}" src`, 'rg -n "QwEr…(len 18)" src'],
    // A credential key's value, assigned before the quote or inside it.
    [
      'TOKEN="correcthorsebattery" node scripts/check.js',
      'TOKEN="corr…(len 19)" node scripts/check.js',
    ],
    [
      'node cli.js --api-key="correcthorsebattery"',
      'node cli.js --api-key="corr…(len 19)"',
    ],
    [
      "mysql --password 'correcthorsebattery' -e 'select 1'",
      // `--password` says the word: every argument is masked.
      "mysql --password 'corr…(len 19)' -e 'sele…(len 8)'",
    ],
    [
      "curl -d 'password=correcthorse' http://localhost:3000/login",
      "curl -d 'pass…(len 21)' http://localhost:3000/login",
    ],
    [
      'curl -H "Authorization: Bearer correcthorse" http://localhost:3000/me',
      'curl -H "Auth…(len 35)" http://localhost:3000/me',
    ],
    ['echo "the password is correcthorse"', 'echo "the …(len 28)"'],
    // A credential word said outside the quotes: every argument, as before.
    [
      "rg -n 'correcthorsebattery' src # the token",
      "rg -n 'corr…(len 19)' src # the token",
    ],
    // An unterminated quote masks the tail.
    ['rg -n "correcthorse battery', 'rg -n "corr…(len 20)'],
  ])('masks %s', (cmd, expected) => {
    expect(redactShellCommand(cmd)).toBe(expected)
  })

  it('masks a registry secret wherever it sits', () => {
    for (const cmd of [
      `rg -n "${FAKE_AWS_KEY}" src`,
      `rg -n ${FAKE_AWS_KEY} src`,
      `rg -n "export function checkSessionToken" src && echo ${FAKE_AWS_KEY}`,
    ])
      expect(redactShellCommand(cmd)).not.toContain(FAKE_AWS_KEY)
  })
})

describe('a fenced code block in hunt trace prose is code, not one quoted span', () => {
  const wrap = (code: string) =>
    `Looking at the code analysis:\n\n\`\`\`typescript\n${code}\n\`\`\`\n\nThe vulnerability is clear`

  it.each([
    // #66 r6 / #65 shapes: code assigning a token from an expression.
    'export function createSession(user: string, now: number) {\n  const token = Math.random().toString(36).slice(2);\n  sessions.set(token, { user, token, expiresAt: now + 3600_000 });\n  return token;\n}',
    "if (url.startsWith('/session/check')) {\n  const token = new URL(url, 'http://x').searchParams.get('token') ?? '';\n  const r = checkSessionToken(token, Date.now());\n}",
    'const DISCOUNTS: Record<string, number> = {\n  welcome: 10,\n  loyal: 15,\n};\n\nexport function discountFor(code: string): number {\n  const percent = DISCOUNTS[code];\n  return percent ?? 0;\n}',
    "const bytes = new Uint8Array(32)\nconst digest = createHash('sha256')",
  ])('keeps the block readable: %#', code => {
    expect(redactSummaryText(wrap(code))).toBe(wrap(code))
  })

  it.each([
    [
      "const password = 'correcthorsebattery';",
      "const password = 'corr…(len 19)';",
    ],
    [`const key = '${SHAPED}';`, "const key = 'Zx9Q…(len 20)';"],
    [`API_KEY=${SHAPED}`, 'API_KEY=Zx9Q…(len 20)'],
    [`const salt = ${RANDOM_LETTERS};`, 'const salt = QwEr…(len 18);'],
  ])('masks the secret-shaped value inside it: %s', (code, expected) => {
    expect(redactSummaryText(wrap(code))).toBe(wrap(expected))
  })

  it('masks a registry secret inside it', () => {
    expect(
      redactSummaryText(wrap(`const id = '${FAKE_AWS_KEY}'`))
    ).not.toContain(FAKE_AWS_KEY)
  })

  it('an unterminated fence: the rest is judged as code, a secret still masked', () => {
    const text =
      "Here:\n\n```ts\nconst token = Math.random().toString(36)\nconst password = 'correcthorsebattery'"
    expect(redactSummaryText(text)).toBe(
      "Here:\n\n```ts\nconst token = Math.random().toString(36)\nconst password = 'corr…(len 19)'"
    )
  })
})
