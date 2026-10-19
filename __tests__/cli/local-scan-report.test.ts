/**
 * @jest-environment node
 */
/**
 * LUM-1255 — the shared `lumo scan` output contract: parseable first line,
 * severity threshold, ordering, redaction-only evidence, JSON v1 shape.
 */
import type { RawSecretFinding } from '@/shared/src/secret-scan/core-types'
import {
  countSeverities,
  formatLocalScan,
  localScanJson,
  meetsThreshold,
  parseSeverity,
  sortFindings,
  summaryLine,
  type LocalScanResult,
} from '../../cli/src/lib/local-scan-report'

function finding(over: Partial<RawSecretFinding>): RawSecretFinding {
  return {
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key-id',
    title: 'AWS access key ID',
    severity: 'HIGH',
    filePath: 'src/a.ts',
    line: 1,
    evidence: 'const k = "AKIA…(len 20)"',
    fingerprint: '0123456789abcdef',
    detail: 'AWS access key ID committed in src/a.ts:1',
    ...over,
  }
}

function result(findings: RawSecretFinding[]): LocalScanResult {
  return {
    scanner: 'secrets',
    scope: 'staged changes',
    filesScanned: 2,
    skipped: [],
    elapsedMs: 7,
    findings,
  }
}

describe('parseSeverity', () => {
  it('accepts any case and rejects other words', () => {
    expect(parseSeverity('high')).toBe('HIGH')
    expect(parseSeverity(' Medium ')).toBe('MEDIUM')
    expect(parseSeverity('severe')).toBeNull()
  })
})

describe('summaryLine / countSeverities', () => {
  it('counts per severity with the singular for one', () => {
    const c = countSeverities([
      finding({ severity: 'HIGH' }),
      finding({ severity: 'LOW' }),
    ])
    expect(summaryLine(c)).toBe('scan: 2 findings (1 high, 0 medium, 1 low)')
    expect(summaryLine(countSeverities([finding({})]))).toBe(
      'scan: 1 finding (1 high, 0 medium, 0 low)'
    )
    expect(summaryLine(countSeverities([]))).toBe(
      'scan: 0 findings (0 high, 0 medium, 0 low)'
    )
  })
})

describe('meetsThreshold', () => {
  it('is at-or-above', () => {
    const low = [finding({ severity: 'LOW' })]
    expect(meetsThreshold(low, 'LOW')).toBe(true)
    expect(meetsThreshold(low, 'MEDIUM')).toBe(false)
    expect(meetsThreshold([finding({ severity: 'HIGH' })], 'MEDIUM')).toBe(true)
    expect(meetsThreshold([], 'LOW')).toBe(false)
  })
})

describe('sortFindings', () => {
  it('orders by severity, then path, then line', () => {
    const sorted = sortFindings([
      finding({ severity: 'LOW', filePath: 'a.ts', line: 1 }),
      finding({ severity: 'HIGH', filePath: 'b.ts', line: 9 }),
      finding({ severity: 'HIGH', filePath: 'b.ts', line: 2 }),
      finding({ severity: 'HIGH', filePath: 'a.ts', line: 5 }),
    ])
    expect(sorted.map(f => `${f.severity} ${f.filePath}:${f.line}`)).toEqual([
      'HIGH a.ts:5',
      'HIGH b.ts:2',
      'HIGH b.ts:9',
      'LOW a.ts:1',
    ])
  })
})

describe('formatLocalScan', () => {
  it('starts with the summary line and shows rule, location and redacted evidence', () => {
    const out = formatLocalScan(result([finding({})]))
    const lines = out.split('\n')
    expect(lines[0]).toBe('scan: 1 finding (1 high, 0 medium, 0 low)')
    expect(lines[1]).toBe('Scope: secrets · staged changes · 2 files · 7ms')
    expect(out).toContain('[HIGH] AWS access key ID')
    expect(out).toContain('secret:aws-access-key-id')
    expect(out).toContain('src/a.ts:1')
    expect(out).toContain('AKIA…(len 20)')
  })

  it('names the downgrade reason on a LOW finding', () => {
    const out = formatLocalScan(
      result([finding({ severity: 'LOW', downgrade: 'PLACEHOLDER_VALUE' })])
    )
    expect(out).toMatch(/\[LOW\] AWS access key ID — .*downgraded/)
  })

  it('lists skipped untracked files', () => {
    const r = { ...result([]), skipped: ['big.bin'] }
    expect(formatLocalScan(r)).toContain('Skipped 1 untracked')
  })

  it('strips terminal escapes from file-derived text', () => {
    const out = formatLocalScan(
      result([finding({ filePath: 'evil\u001b[31m.ts' })])
    )
    expect(out).not.toContain('\u001b')
  })
})

describe('localScanJson', () => {
  it('is versioned and carries fingerprints and the summary', () => {
    const json = localScanJson(result([finding({})])) as Record<string, unknown>
    expect(json).toMatchObject({
      version: 1,
      scanner: 'secrets',
      summary: { total: 1, high: 1, medium: 0, low: 0 },
      findings: [
        {
          ruleId: 'secret:aws-access-key-id',
          fingerprint: '0123456789abcdef',
          downgrade: null,
        },
      ],
    })
  })
})
