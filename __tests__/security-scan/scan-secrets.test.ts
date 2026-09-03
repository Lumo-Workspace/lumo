/** @jest-environment node */
import {
  scanSecrets,
  redactKnownSecrets,
  MAX_SCANNED_LINE_CHARS,
} from '@/lib/security-scan/scan-secrets'
import {
  redactSecret,
  redactLine,
  secretFingerprint,
  vulnerabilityFingerprint,
  shannonEntropy,
  maskQuotedValues,
} from '@/lib/security-scan/redact'
import {
  isDowngradedPath,
  isPlaceholderValue,
} from '@/lib/security-scan/secret-patterns'
import type { AddedFile } from '@/lib/security-scan/types'

// Each entry: a synthetic (non-functional) value shaped like the real thing.
const CORPUS: { ruleId: string; line: string; value: string }[] = [
  {
    ruleId: 'secret:aws-access-key-id',
    line: 'const k = "AKIAABCDEFGHIJKLMNOP"',
    value: 'AKIAABCDEFGHIJKLMNOP',
  },
  {
    ruleId: 'secret:aws-secret-access-key',
    line: 'aws_secret_access_key = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN"',
    value: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN',
  },
  {
    ruleId: 'secret:github-token',
    line: 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  },
  {
    ruleId: 'secret:github-pat',
    line: 'PAT=github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
    value: 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
  },
  {
    ruleId: 'secret:slack-token',
    line: 'SLACK=xoxb-123456789012-abcdefghijkl',
    value: 'xoxb-123456789012-abcdefghijkl',
  },
  {
    ruleId: 'secret:slack-webhook',
    line: 'url: https://hooks.slack.com/services/T0ABC/B0DEF/abcdefghijklmnopqrstuvwx',
    value:
      'https://hooks.slack.com/services/T0ABC/B0DEF/abcdefghijklmnopqrstuvwx',
  },
  {
    ruleId: 'secret:stripe-key',
    line: 'stripe = "sk_live_abcdefghijklmnopqrstuvwx"',
    value: 'sk_live_abcdefghijklmnopqrstuvwx',
  },
  {
    ruleId: 'secret:anthropic-key',
    line: 'ANTHROPIC="sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"',
    value: 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789',
  },
  {
    ruleId: 'secret:openai-key',
    line: 'OPENAI="sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"',
    value: 'sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
  },
  {
    ruleId: 'secret:google-api-key',
    line: 'key=AIzaSyAbcdefghijklmnopqrstuvwxyz0123456',
    value: 'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456',
  },
  {
    ruleId: 'secret:sendgrid-key',
    line: 'SG="SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"',
    value:
      'SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  },
  {
    ruleId: 'secret:private-key-block',
    line: '-----BEGIN RSA PRIVATE KEY-----',
    value: '-----BEGIN RSA PRIVATE KEY-----',
  },
  {
    ruleId: 'secret:jwt',
    line: 'auth = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"',
    value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
  },
  {
    ruleId: 'secret:database-url',
    line: 'DATABASE_URL="postgres://lumo:hunter2secret@db.example.com:5432/app"',
    value: 'hunter2secret',
  },
  {
    ruleId: 'secret:generic-assignment',
    line: 'const apiKey = "Zx9Qw3Lp7Vb2Nm5Rt8Ky1Hg6Fd4Sa0Je"',
    value: 'Zx9Qw3Lp7Vb2Nm5Rt8Ky1Hg6Fd4Sa0Je',
  },
]

function file(path: string, lines: string[]): AddedFile {
  return { path, lines: lines.map((text, i) => ({ lineNo: i + 1, text })) }
}

test('secret corpus: detects every fixture and never stores the raw value', () => {
  const files = [
    file(
      'src/config.ts',
      CORPUS.map(c => c.line)
    ),
  ]
  const findings = scanSecrets(files)

  // Every corpus line yields exactly one finding with the expected rule.
  expect(findings).toHaveLength(CORPUS.length)
  CORPUS.forEach((c, i) => {
    const f = findings.find(x => x.line === i + 1)
    expect(f?.ruleId).toBe(c.ruleId)
    expect(f?.severity).not.toBe('LOW')
    expect(f?.filePath).toBe('src/config.ts')
  })

  // RED LINE: no persisted field contains the raw value.
  for (const f of findings) {
    const c = CORPUS[f.line - 1]!
    for (const field of [
      f.title,
      f.detail,
      f.evidence,
      f.fingerprint,
      f.ruleId,
    ]) {
      expect(field).not.toContain(c.value)
    }
    expect(f.fingerprint).toHaveLength(16)
    expect(f.fingerprint).toBe(secretFingerprint(f.ruleId, c.value))
  }
  expect(redactSecret('AKIAABCDEFGHIJKLMNOP')).toBe('AKIA…(len 20)')
})

test('downgrades test/fixture paths and placeholder values to LOW', () => {
  const testFile = file('__tests__/x.test.ts', [
    'const k = "AKIAABCDEFGHIJKLMNOP"',
  ])
  const docFile = file('README.md', ['AKIAABCDEFGHIJKLMNOP'])
  const placeholder = file('src/real.ts', ['const k = "AKIAIOSFODNN7EXAMPLE"'])
  const results = scanSecrets([testFile, docFile, placeholder])
  expect(results).toHaveLength(3)
  expect(results.every(r => r.severity === 'LOW')).toBe(true)
})

test('generic assignment requires entropy and ignores low-entropy strings', () => {
  const low = file('src/a.ts', ['const password = "aaaaaaaaaaaaaaaaaaaa"'])
  expect(scanSecrets([low])).toHaveLength(0)
  const masked = maskQuotedValues('const token = "Zx9Qw3Lp7Vb2Nm5Rt8Ky"')
  expect(masked).not.toContain('Zx9Qw3Lp7Vb2Nm5Rt8Ky')
  expect(masked).toContain('Zx9Q…(len 20)')
})

test('keeps only the highest-severity hit per line', () => {
  // The Anthropic key also matches the generic OpenAI prefix — one finding, not two.
  const f = file('src/a.ts', ['sk-ant-abcdefghijklmnopqrstuvwxyz0123456789'])
  const r = scanSecrets([f])
  expect(r).toHaveLength(1)
  expect(r[0]?.ruleId).toBe('secret:anthropic-key')
})

test('vulnerabilityFingerprint: stable, 16 hex chars, title normalisation is case/whitespace-insensitive', () => {
  const a = vulnerabilityFingerprint(
    'secret:aws-access-key-id',
    'src/config.ts',
    'AWS access key ID'
  )
  const b = vulnerabilityFingerprint(
    'secret:aws-access-key-id',
    'src/config.ts',
    '  aws   ACCESS key ID  '
  )
  expect(a).toHaveLength(16)
  expect(/^[0-9a-f]{16}$/.test(a)).toBe(true)
  // Stable across repeat calls with identical inputs.
  expect(
    vulnerabilityFingerprint(
      'secret:aws-access-key-id',
      'src/config.ts',
      'AWS access key ID'
    )
  ).toBe(a)
  // Case/whitespace differences in title normalise to the same fingerprint.
  expect(b).toBe(a)
  // A different file path changes the fingerprint.
  expect(
    vulnerabilityFingerprint(
      'secret:aws-access-key-id',
      'src/other.ts',
      'AWS access key ID'
    )
  ).not.toBe(a)
})

test('redactLine replaces every occurrence of the value and nothing else', () => {
  const line = 'key1=secretvalue123 key2=secretvalue123'
  const out = redactLine(line, 'secretvalue123')
  expect(out).not.toContain('secretvalue123')
  expect(out).toBe('key1=secr…(len 14) key2=secr…(len 14)')
  expect(redactLine('unchanged', '')).toBe('unchanged')
})

test('shannonEntropy: 0 for a repeated char, > 3.5 for a mixed 32-char string', () => {
  expect(shannonEntropy('aaaaaaaa')).toBe(0)
  expect(shannonEntropy('Zx9Qw3Lp7Vb2Nm5Rt8Ky1Hg6Fd4Sa0Je')).toBeGreaterThan(
    3.5
  )
})

test('isDowngradedPath flags test/fixture/doc paths and leaves real source alone', () => {
  expect(isDowngradedPath('__tests__/x.test.ts')).toBe(true)
  expect(isDowngradedPath('lib/security-scan/fixtures/sample.ts')).toBe(true)
  expect(isDowngradedPath('README.md')).toBe(true)
  expect(isDowngradedPath('src/real.ts')).toBe(false)
  expect(isDowngradedPath('lib/security-scan/scan-secrets.ts')).toBe(false)
})

test('isPlaceholderValue: bounded markers and whole-value filler are placeholders; a marker-like substring inside a real token is not', () => {
  expect(isPlaceholderValue('AKIAIOSFODNN7EXAMPLE')).toBe(true)
  expect(isPlaceholderValue('xxxxxxxxxxxxxxxx')).toBe(true)
  expect(
    isPlaceholderValue('ghp_abcdefghijxxxxklmnopqrstuvwxyz0123456789')
  ).toBe(false)
})

test('two secrets on one line: both are detected, exactly one finding, neither raw value survives in evidence', () => {
  const f = file('src/two.ts', [
    'const a = "AKIAABCDEFGHIJKLMNOP"; const b = "sk_live_abcdefghijklmnopqrstuvwx"',
  ])
  const r = scanSecrets([f])
  expect(r).toHaveLength(1)
  expect(r[0]?.ruleId).toBe('secret:aws-access-key-id')
  expect(r[0]?.evidence).not.toContain('AKIAABCDEFGHIJKLMNOP')
  expect(r[0]?.evidence).not.toContain('sk_live_abcdefghijklmnopqrstuvwx')
})

test('database-url password requires 6+ chars: a short password produces no finding, a 6+ char one is redacted', () => {
  const shortPw = file('src/db.ts', [
    'const url = "postgres://lumo:pw7@db.example.com:5432/app"',
  ])
  expect(scanSecrets([shortPw])).toHaveLength(0)

  const longerPw = file('src/db2.ts', [
    'const url = "postgres://lumo:hunter2@db.example.com:5432/app"',
  ])
  const r = scanSecrets([longerPw])
  expect(r).toHaveLength(1)
  expect(r[0]?.evidence).not.toContain('hunter2')
})

test('maskQuotedValues redacts a double-quoted span containing an apostrophe', () => {
  const line = `const msg = "it's a leaked secretvalue123456"`
  const masked = maskQuotedValues(line)
  expect(masked).not.toContain('secretvalue123456')
  expect(masked).toContain('…(len')
})

test('redactKnownSecrets redacts an unquoted AWS key using the pattern registry', () => {
  const line = 'export const key = AKIAABCDEFGHIJKLMNOP'
  const masked = redactKnownSecrets(line)
  expect(masked).not.toContain('AKIAABCDEFGHIJKLMNOP')
  expect(masked).toContain('AKIA…(len 20)')
})

test('skips lines longer than MAX_SCANNED_LINE_CHARS entirely', () => {
  const longLine =
    'x'.repeat(MAX_SCANNED_LINE_CHARS + 1) + ' AKIAABCDEFGHIJKLMNOP'
  const f = file('src/bundle.min.js', [longLine])
  expect(scanSecrets([f])).toHaveLength(0)
})
