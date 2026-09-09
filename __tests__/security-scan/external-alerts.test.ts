/** @jest-environment node */
import {
  mapCodeScanningAlerts,
  enhanceSecretFindings,
  externalSeverity,
  toolSlug,
  secretVendor,
  ruleVendor,
} from '@/lib/security-scan/external-alerts'
import type {
  CodeScanningAlert,
  SecretScanningAlert,
  RawSecretFinding,
} from '@/lib/security-scan/types'

const KEY = 'AKIAABCDEFGHIJKLMNOP'

const alert = (over: Partial<CodeScanningAlert> = {}): CodeScanningAlert => ({
  number: 7,
  htmlUrl: 'https://github.com/o/r/security/code-scanning/7',
  toolName: 'Semgrep OSS',
  ruleId: 'javascript.express.security.injection.tainted-sql-string',
  ruleDescription: 'Detected SQL statement built from user input',
  securitySeverityLevel: 'high',
  severity: 'error',
  path: 'src/db.ts',
  startLine: 12,
  messageText: `Untrusted input reaches $queryRaw; token "${KEY}" seen`,
  ...over,
})

describe('externalSeverity', () => {
  it('maps security_severity_level first, then falls back to rule.severity', () => {
    expect(externalSeverity(alert({ securitySeverityLevel: 'critical' }))).toBe(
      'HIGH'
    )
    expect(externalSeverity(alert({ securitySeverityLevel: 'high' }))).toBe(
      'HIGH'
    )
    expect(externalSeverity(alert({ securitySeverityLevel: 'medium' }))).toBe(
      'MEDIUM'
    )
    expect(externalSeverity(alert({ securitySeverityLevel: 'low' }))).toBe(
      'LOW'
    )
    expect(
      externalSeverity(
        alert({ securitySeverityLevel: null, severity: 'error' })
      )
    ).toBe('MEDIUM')
    expect(
      externalSeverity(
        alert({ securitySeverityLevel: null, severity: 'warning' })
      )
    ).toBe('LOW')
    expect(
      externalSeverity(alert({ securitySeverityLevel: null, severity: null }))
    ).toBe('LOW')
  })
})

describe('toolSlug', () => {
  it('lower-cases and collapses non-alphanumerics', () => {
    expect(toolSlug('Semgrep OSS')).toBe('semgrep-oss')
    expect(toolSlug('CodeQL')).toBe('codeql')
    expect(toolSlug('  gitleaks  ')).toBe('gitleaks')
    expect(toolSlug('')).toBe('unknown')
  })
})

describe('mapCodeScanningAlerts', () => {
  it('keeps only alerts located in a changed file and builds an EXTERNAL_TOOL row', () => {
    const rows = mapCodeScanningAlerts(
      [
        alert(),
        alert({ number: 8, path: 'src/untouched.ts' }),
        alert({ number: 9, path: null }),
      ],
      new Set(['src/db.ts'])
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toMatchObject({
      kind: 'VULNERABILITY',
      ruleId:
        'ext:semgrep-oss:javascript.express.security.injection.tainted-sql-string',
      severity: 'HIGH',
      filePath: 'src/db.ts',
      line: 12,
      title: 'Detected SQL statement built from user input',
      evidence: '',
      externalRef: 'https://github.com/o/r/security/code-scanning/7',
    })
    expect(row.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('redacts secrets out of title and detail — the payload never lands raw', () => {
    const rows = mapCodeScanningAlerts(
      [alert({ ruleDescription: `Hardcoded key ${KEY}` })],
      new Set(['src/db.ts'])
    )
    const row = rows[0]!
    expect(row.title).not.toContain(KEY)
    expect(row.detail).not.toContain(KEY)
    expect(JSON.stringify(row)).not.toContain(KEY)
  })

  it('falls back to the rule id as title and names the tool in detail', () => {
    const rows = mapCodeScanningAlerts(
      [alert({ ruleDescription: null, messageText: null })],
      new Set(['src/db.ts'])
    )
    expect(rows[0]!.title).toBe(
      'javascript.express.security.injection.tainted-sql-string'
    )
    expect(rows[0]!.detail).toBe('Reported by Semgrep OSS.')
  })

  it('same alert number → same fingerprint; different number → different', () => {
    const [a] = mapCodeScanningAlerts([alert()], new Set(['src/db.ts']))
    const [b] = mapCodeScanningAlerts([alert()], new Set(['src/db.ts']))
    const [c] = mapCodeScanningAlerts(
      [alert({ number: 8 })],
      new Set(['src/db.ts'])
    )
    expect(a!.fingerprint).toBe(b!.fingerprint)
    expect(a!.fingerprint).not.toBe(c!.fingerprint)
  })
})

describe('vendor matching', () => {
  it('derives a vendor family from GitHub secret_type and from a Lumo ruleId', () => {
    expect(secretVendor('aws_access_key_id')).toBe('aws')
    expect(secretVendor('github_personal_access_token')).toBe('github')
    expect(secretVendor('slack_api_token')).toBe('slack')
    expect(ruleVendor('secret:aws-access-key-id')).toBe('aws')
    expect(ruleVendor('secret:github-pat')).toBe('github')
    expect(ruleVendor('secret:generic-assignment')).toBe('generic')
  })
})

describe('enhanceSecretFindings', () => {
  const finding = (over: Partial<RawSecretFinding> = {}): RawSecretFinding => ({
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key-id',
    title: 'AWS access key ID',
    severity: 'MEDIUM',
    filePath: 'src/cfg.ts',
    line: 3,
    evidence: 'const k = "AKIA…(len 20)"',
    fingerprint: 'fp1',
    detail: 'An AWS access key ID was added.',
    ...over,
  })
  const active = (
    over: Partial<SecretScanningAlert> = {}
  ): SecretScanningAlert => ({
    number: 3,
    htmlUrl: 'https://github.com/o/r/security/secret-scanning/3',
    secretType: 'aws_access_key_id',
    secretTypeDisplayName: 'Amazon AWS Access Key ID',
    paths: ['src/cfg.ts'],
    ...over,
  })

  it('upgrades a same-file, same-vendor hit to HIGH and records the alert URL', () => {
    const [out] = enhanceSecretFindings([finding()], [active()])
    expect(out).toMatchObject({
      severity: 'HIGH',
      externalRef: 'https://github.com/o/r/security/secret-scanning/3',
    })
    expect(out!.detail).toContain('Amazon AWS Access Key ID')
    expect(out!.detail).toContain('active')
    expect(out!.fingerprint).toBe('fp1')
  })

  it('leaves findings alone when the file or the vendor differs', () => {
    const untouchedFile = enhanceSecretFindings(
      [finding()],
      [active({ paths: ['other.ts'] })]
    )
    expect(untouchedFile[0]).toMatchObject({
      severity: 'MEDIUM',
      externalRef: null,
    })
    const otherVendor = enhanceSecretFindings(
      [finding()],
      [active({ secretType: 'slack_api_token' })]
    )
    expect(otherVendor[0]).toMatchObject({
      severity: 'MEDIUM',
      externalRef: null,
    })
  })

  it('a generic-assignment hit accepts any active alert in the same file', () => {
    const [out] = enhanceSecretFindings(
      [finding({ ruleId: 'secret:generic-assignment' })],
      [active({ secretType: 'stripe_api_key' })]
    )
    expect(out!.severity).toBe('HIGH')
  })

  it('never lowers severity and adds nothing when there are no alerts', () => {
    const [out] = enhanceSecretFindings([finding({ severity: 'HIGH' })], [])
    expect(out).toMatchObject({ severity: 'HIGH', externalRef: null })
  })
})
