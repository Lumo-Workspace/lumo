/**
 * LUM-1200 follow-up #5 — production TC15 (lumo-agent-test#69 r1 / r2): the
 * hunt model's own non-secret inline code was masked in trace prose.
 *   r1: "Uses `Math.random()` to generate tokens: `Math…(len 39)`" — the span
 *       `Math.random().toString(36).substring(2)` follows the credential word
 *       "tokens:" (`CREDENTIAL_KEY_BEFORE_RE`);
 *   r2: "**session-store.ts line 11**: `cons…(len 50)`" — the span
 *       `const token = Math.random().toString(36).slice(2);` assigns a
 *       credential key (`assignsCredentialValue`).
 * A code expression is not a credential literal and stays readable; a literal
 * assigned to (or following) a credential key stays masked, and a secret
 * literal inside a code expression is still masked (fail closed).
 */
import { redactSummaryText } from '@/lib/security-scan/scan-secrets'
import {
  isCodeExpression,
  maskQuotedKeyedValues,
} from '@/lib/security-scan/redact'

// Built at runtime so no credential-shaped literal sits in the source.
const SHAPED = ['Zx9Qw3Lp', '7Vb2Nm5R', 't8Ky'].join('')
const PASSPHRASE = ['correct', 'horse', 'battery'].join('')
const RANDOM_LETTERS = ['QwErTyUi', 'OpAsDfGh', 'Jk'].join('')
const MIXED_ID = ['hunter', '2x'].join('')

const MASK_RE = /…\(len \d+\)/

describe('production TC15 shapes stay readable', () => {
  it('r1: code after "tokens:" is kept', () => {
    const text =
      '1. **Token Generation (session-store.ts, line 7-10)**:\n   - Uses `Math.random()` to generate tokens: `Math.random().toString(36).substring(2)`\n   - This produces only ~'
    expect(redactSummaryText(text)).toBe(text)
  })

  it('r2: a credential key assigned a code expression is kept', () => {
    const text =
      '1. **session-store.ts line 11**: `const token = Math.random().toString(36).slice(2);` - Uses weak Math.random() for token generation'
    expect(redactSummaryText(text)).toBe(text)
  })
})

describe('code expressions after or assigned to a credential key', () => {
  it.each([
    "the token is `crypto.randomBytes(32).toString('hex')`",
    'token: `process.env.SESSION_TOKEN`',
    'reads the token from `req.query.token`',
    'password: `await hashPassword(input.password)`',
    'the secret is `config.get(name) ?? defaultSecret()`',
    'token: `new URL(request.url).searchParams.get(name)`',
    '`const apiKey = process.env.API_KEY;`',
    '`const token = crypto.randomUUID();`',
    '`let secret = req.headers[name] || fallback();`',
    '`const token = Date.now() + Math.random();`',
    '`session.token = generateToken(user.id)`',
  ])('keeps %j', text => {
    expect(maskQuotedKeyedValues(text)).toBe(text)
  })
})

describe('literal values stay masked (adversarial)', () => {
  it.each([
    // A quoted literal assigned to a credential key.
    `\`const token = '${PASSPHRASE}';\``,
    "`const token = 'abc123';`",
    `\`const password = "${PASSPHRASE}"\``,
    // An unquoted literal assigned to a credential key.
    `\`const token = ${PASSPHRASE};\``,
    '`const token = 12345678;`',
    // A literal after a credential key — words, dotted, dashed, numbers.
    `the token is \`${PASSPHRASE}\``,
    'password: `correct.horse.battery`',
    'password: `correct-horse-battery`',
    'password: `correct horse battery staple`',
    'the token is `12345678901234`',
    'the token is `abcdefgh(ijkl`',
    // Credential-shaped or random identifiers are no code.
    `token: \`${SHAPED}.toString()\``,
    `token: \`${RANDOM_LETTERS}()\``,
    `token: \`${MIXED_ID}.call(1)\``,
    // A keyword before a bare word is no code shape (review of #1532).
    `token: \`new ${PASSPHRASE}\``,
    `token: \`await ${PASSPHRASE}\``,
    `token: \`typeof ${PASSPHRASE}\``,
    `token: \`new ${MIXED_ID}pass\``,
    `\`const token = new ${PASSPHRASE};\``,
    `\`const token = await ${PASSPHRASE};\``,
    `the secret is \`await ${PASSPHRASE} || fallback()\``,
  ])('masks %j', text => {
    expect(maskQuotedKeyedValues(text)).toMatch(MASK_RE)
  })

  it('masks a secret literal inside a code expression, and only it', () => {
    const text = `\`const token = Buffer.from('${PASSPHRASE}').toString('hex');\``
    const out = maskQuotedKeyedValues(text)
    expect(out).not.toContain(PASSPHRASE)
    expect(out).toContain("`const token = Buffer.from('corr…(len 19)')")
    expect(out).toContain(".toString('hex');`")
  })

  it('masks a fallback literal in a code expression after a key', () => {
    const text = `token: \`getToken() || '${PASSPHRASE}'\``
    const out = maskQuotedKeyedValues(text)
    expect(out).not.toContain(PASSPHRASE)
    expect(out).toContain('getToken() ||')
  })

  it('masks a shaped literal in a code expression in any context', () => {
    const text = `\`const token = sign('${SHAPED}')\``
    expect(maskQuotedKeyedValues(text)).not.toContain(SHAPED)
  })

  it('masks a literal that starts a code expression whole', () => {
    const text = `\`const token = '${PASSPHRASE}' + suffix();\``
    expect(maskQuotedKeyedValues(text)).not.toContain(PASSPHRASE)
  })

  it('an unpaired quote inside the expression still fails closed', () => {
    const text = `token: \`Buffer.from('${PASSPHRASE})\``
    expect(maskQuotedKeyedValues(text)).not.toContain(PASSPHRASE)
  })

  it('a second assignment of a literal in the same span is masked', () => {
    const text = `\`const token = makeToken(); const secret = '${PASSPHRASE}';\``
    expect(maskQuotedKeyedValues(text)).not.toContain(PASSPHRASE)
  })
})

describe('isCodeExpression', () => {
  it.each([
    'Math.random().toString(36).substring(2)',
    'Math.random().toString(36).slice(2);',
    "crypto.randomBytes(32).toString('hex')",
    'process.env.SESSION_TOKEN',
    'req.query.token',
    'a ? b : c',
    'new URL(input)',
    'await getToken()',
    'await this.session.token',
    'await client.tokens.create(opts)',
  ])('reads %j as code', v => expect(isCodeExpression(v)).toBe(true))

  it.each([
    '',
    'abc123def',
    'correct.horse.battery',
    'correct-horse-battery',
    'correct horse battery',
    'config.auth.token',
    '12345678',
    'f(1',
    'a ? b',
    'p@ss(word)',
    `${MIXED_ID}()`,
    'new correcthorsebattery',
    'await correcthorsebattery',
    'typeof correcthorsebattery',
    'await new',
  ])('does not read %j as code', v => expect(isCodeExpression(v)).toBe(false))
})
