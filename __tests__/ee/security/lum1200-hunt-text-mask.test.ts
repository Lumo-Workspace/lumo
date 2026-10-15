/**
 * LUM-1200 follow-up #4 — production TC12 (lumo-agent-test#67): masking
 * left in hunt text after #1529.
 *  F. a refused command's `reason` masked the quoted segment it echoes
 *     (`xargs grep -l "isSe…(len 27)"`) while the record's `cmd` was intact;
 *  G. a hunt finding's detail lost its whole falsifier explanation to one
 *     unpaired backtick (`` `toke…(len 447) ``);
 *  H. trace prose quoting already-masked tool output back
 *     (`` `if (url.startsWith('/ses…(len 14)'))` ``) was masked whole a second
 *     time (`` `if (…(len 35)` ``).
 * Each fix keeps real secrets masked — the adversarial half of each block.
 */
import {
  redactShellCommand,
  redactShellReason,
  redactSummaryText,
} from '@/lib/security-scan/scan-secrets'
import { redactFindingProse } from '@/ee/security/security-scan/finding-prose'
import { checkHuntCommand } from '@/ee/security/security-scan/hunt/shell-allowlist'

// Built at runtime so no credential-shaped literal sits in the source.
const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('')
const SHAPED = ['Zx9Qw3Lp', '7Vb2Nm5R', 't8Ky'].join('')
const RANDOM_LETTERS = ['QwErTyUi', 'OpAsDfGh', 'Jk'].join('')
const PASSPHRASE = ['correct', 'horse', 'battery'].join('')
const ENV_KEY = ['TO', 'KEN'].join('')

function refusal(command: string): string {
  const check = checkHuntCommand(command)
  if (check.ok) throw new Error(`expected a refusal for ${command}`)
  return check.reason
}

describe('F. a refused command reason reads as its cmd does', () => {
  it.each([
    // #67 r4: the segment the gate refused, echoed after `: `.
    'rg -l "createSession" src | xargs grep -l "isSessionValid|checkSessionToken"',
    // #67 r3: a heredoc segment (`<` outside quotes), echoed cut at the cap.
    "python3 << 'EOF'\nimport re\n\n# Read the file\nwith open('src/server.ts', 'r') as f:\n    content = f.read()\nEOF\n",
    'rg -n "export function checkSessionToken" src > out.txt',
  ])('keeps the echoed segment of %j', command => {
    const reason = refusal(command)
    expect(redactShellReason(reason, command)).toBe(reason)
    expect(redactShellCommand(command)).toBe(command)
  })

  it('keeps a reason that quotes no tail of the command (prose)', () => {
    const command = 'tee src/notes.txt'
    const reason = refusal(command)
    expect(reason).not.toContain(': tee')
    expect(redactShellReason(reason, command)).toBe(reason)
  })

  it.each([
    // Shape: a generated value in the echoed segment.
    [`rg -n '${SHAPED}' src > out.txt`, `'Zx9Q…(len 20)'`],
    [`rg -n "${RANDOM_LETTERS}" src > out.txt`, '"QwEr…(len 18)"'],
    // A credential key's value, in the echoed segment.
    [`${ENV_KEY}="${PASSPHRASE}" rg -n x src > out.txt`, '"corr…(len 19)"'],
    // A credential word said in ANOTHER segment of the command masks the
    // echoed segment's quoted arguments, as it masks the whole `cmd`.
    [
      `grep -rn password src ; rg -n "${PASSPHRASE}" src > o.txt`,
      '"corr…(len 19)"',
    ],
  ])('masks the secret in the echoed segment of %j', (command, masked) => {
    const reason = refusal(command)
    const out = redactShellReason(reason, command)
    expect(out).toContain(masked)
    expect(out).not.toContain(SHAPED)
    expect(out).not.toContain(RANDOM_LETTERS)
    expect(out).not.toContain(PASSPHRASE)
  })

  it('masks a registry secret anywhere in the reason', () => {
    const command = `rg -n ${FAKE_AWS_KEY} src > out.txt`
    const out = redactShellReason(refusal(command), command)
    expect(out).not.toContain(FAKE_AWS_KEY)
    expect(out).toContain('…(len 20)')
  })

  it('a reason echoing nothing of the command still masks a shaped value', () => {
    const out = redactShellReason(`command '${SHAPED}' is not allowed`, 'x')
    expect(out).not.toContain(SHAPED)
  })
})

describe('G. an unpaired backtick in finding prose does not swallow the rest', () => {
  const detail =
    'An attacker can replay a token\n\nFalsifier: INCONCLUSIVE — The entry reads the attacker-controlled `token` query parameter and compares `expiresAt > now || token.length > 0`; the ` stray mark leaves the rest of this explanation readable.\nEntry: checkSessionToken (src/services/session-check.ts:3)'

  it('keeps the falsifier text after a stray backtick', () => {
    expect(redactFindingProse(detail)).toBe(detail)
    expect(redactSummaryText(detail)).toBe(detail)
  })

  it('keeps a stray backtick that is the only one', () => {
    const text =
      'The token check uses ` as a marker and then goes on for a long while'
    expect(redactSummaryText(text)).toBe(text)
  })

  it.each([
    // A value straddling the stray mark: shaped, or right after a key.
    [`the value is \`${SHAPED} and more text`, SHAPED],
    [`the password is \`${PASSPHRASE} and more text`, PASSPHRASE],
    // Ambiguous pairing: a shaped value outside every guessed span.
    [`\`a\` then ${SHAPED} and \`b\` and a stray \``, SHAPED],
    [`\`a\` then ${RANDOM_LETTERS} and \`b\` and a stray \``, RANDOM_LETTERS],
    // A closed span assigning a credential is still masked beside a stray one.
    [
      `set \`const pw = '${PASSPHRASE}'\` here and a stray \` later`,
      PASSPHRASE,
    ],
    // A registry secret after the stray mark.
    [`the key \` ${FAKE_AWS_KEY} leaked`, FAKE_AWS_KEY],
  ])('masks the secret in %j', (text, secret) => {
    expect(redactSummaryText(text)).not.toContain(secret)
    expect(redactFindingProse(text)).not.toContain(secret)
  })

  it('a hardcoded-credential finding keeps the strict pass', () => {
    const text = `the password \`${PASSPHRASE} is committed`
    expect(redactFindingProse(text, true)).not.toContain(PASSPHRASE)
  })
})

describe('H. trace prose quoting masked tool output is not masked again', () => {
  it.each([
    "From the output I can see:\n1. Line 31: `if (url.startsWith('/ses…(len 14)'))` - this is the session check route\n2. Line 39: `if (url.startsWith('/ses…(len 8)') && req.method === 'POST')` - create",
    'The output is showing truncated values with `…(len N)` notation.',
    "Line 31: `if (url.startsWith('/session-check'))` uses a prefix match",
  ])('keeps %j', text => {
    expect(redactSummaryText(text)).toBe(text)
  })

  it.each([
    // A marker this pass plants (a registry hit in the model's own text)
    // still masks its whole span: it may hide a second value beside it.
    [`\`aws ${FAKE_AWS_KEY} ${PASSPHRASE} staple\``, PASSPHRASE],
    // An echoed marker beside a shaped value: masked by shape.
    [`\`url('/ses…(len 14)') ${SHAPED}\``, SHAPED],
    // An echoed marker beside a credential key's value: masked by key.
    [`\`check('/ses…(len 14)'); const pw = '${PASSPHRASE}'\``, PASSPHRASE],
  ])('masks the secret in %j', (text, secret) => {
    const out = redactSummaryText(text)
    expect(out).not.toContain(secret)
    expect(out).not.toContain(FAKE_AWS_KEY)
  })
})

// Review of #1531 @3f7780f — two fail-open gaps in the fixes above.
describe('review of #1531: a stray backtick judges its whole sentence', () => {
  it.each([
    // A secret two words after the mark.
    [`the value is \` then ${SHAPED} follows`, SHAPED],
    [`see \` the run ${RANDOM_LETTERS} here`, RANDOM_LETTERS],
    // A multi-word passphrase after a credential key.
    ['the password is `correct horse battery staple', 'correct horse battery'],
    // An assignment a few words on.
    [`a stray \` and then pw = ${PASSPHRASE} in code`, PASSPHRASE],
  ])('masks the secret in %j', (text, secret) => {
    expect(redactSummaryText(text)).not.toContain(secret)
    expect(redactFindingProse(text)).not.toContain(secret)
  })

  it('keeps the next sentence readable', () => {
    const text = `the value is \` then ${SHAPED} follows.\nThe next line stays readable.`
    const out = redactSummaryText(text)
    expect(out).not.toContain(SHAPED)
    expect(out).toContain('The next line stays readable.')
  })
})

describe('review of #1531: an echoed marker exempts only itself', () => {
  it.each([
    // A value glued to the echoed marker.
    [`\`postgres://u:hunt…(len 13)@h/d?t=${PASSPHRASE}\``, PASSPHRASE],
    // A value in the word beside it.
    [`\`login('/ses…(len 14)') ${PASSPHRASE}\``, PASSPHRASE],
    [`\`${PASSPHRASE} '/ses…(len 14)'\``, PASSPHRASE],
  ])('masks the neighbour in %j', (text, secret) => {
    expect(redactSummaryText(text)).not.toContain(secret)
  })
})
