/** @jest-environment node */
import { scanSecrets } from '@/lib/security-scan/scan-secrets'
import {
  redactSecret,
  secretFingerprint,
  maskQuotedValues,
} from '@/lib/security-scan/redact'
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
