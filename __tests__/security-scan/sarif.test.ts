/** @jest-environment node */
import {
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  sarifSeverity,
  sarifKind,
  toolSlug,
  MAX_SARIF_FINDINGS,
} from '@/lib/security-scan/sarif'
import { addedLinesWithNumbers } from '@/lib/security-scan/diff-lines'

const KEY = 'AKIAABCDEFGHIJKLMNOP'

function sarif(over: {
  tool?: string
  rules?: unknown[]
  results?: unknown[]
  version?: string
}) {
  return {
    version: over.version ?? '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: over.tool ?? 'Semgrep OSS',
            rules: over.rules ?? [
              {
                id: 'js.sqli',
                shortDescription: { text: 'SQL built from user input' },
                helpUri: 'https://sg.run/abc',
                properties: {
                  'security-severity': '8.5',
                  tags: ['security', 'CWE-89'],
                },
              },
            ],
          },
        },
        results: over.results ?? [
          {
            ruleId: 'js.sqli',
            level: 'error',
            message: { text: 'Untrusted input reaches $queryRaw' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: {
                    startLine: 2,
                    snippet: { text: 'const q = `x ${id}`' },
                  },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'abc123:1' },
          },
        ],
      },
    ],
  }
}

const DIFF = [
  '--- a/src/db.ts',
  '+++ b/src/db.ts',
  '@@ -1,0 +1,3 @@',
  '+import x from "y"',
  '+const q = `x ${id}`',
  '+export {}',
].join('\n')
const changed = changedLinesOf(addedLinesWithNumbers(DIFF))

describe('parseSarif', () => {
  it('reduces runs to tool name, rule map and results', () => {
    const runs = parseSarif(sarif({}))
    expect(runs).toHaveLength(1)
    expect(runs[0]!.toolName).toBe('Semgrep OSS')
    expect(runs[0]!.rules.get('js.sqli')).toEqual({
      id: 'js.sqli',
      shortDescription: 'SQL built from user input',
      helpUri: 'https://sg.run/abc',
      securitySeverity: 8.5,
      tags: ['security', 'CWE-89'],
    })
    expect(runs[0]!.results[0]).toEqual({
      ruleId: 'js.sqli',
      level: 'error',
      messageText: 'Untrusted input reaches $queryRaw',
      path: 'src/db.ts',
      startLine: 2,
      snippet: 'const q = `x ${id}`',
      primaryLocationLineHash: 'abc123:1',
    })
  })

  it('rejects anything that is not SARIF 2.1.0 with a 422-shaped error', () => {
    expect(() => parseSarif(sarif({ version: '2.0.0' }))).toThrow(
      expect.objectContaining({ status: 422 })
    )
    expect(() => parseSarif({ hello: 'world' })).toThrow(
      expect.objectContaining({ status: 422 })
    )
    expect(() => parseSarif('nope')).toThrow(
      expect.objectContaining({ status: 422 })
    )
  })

  it('strips a leading ./ from artifact uris and tolerates missing pieces', () => {
    const runs = parseSarif(
      sarif({
        results: [
          {
            ruleId: 'r',
            locations: [
              { physicalLocation: { artifactLocation: { uri: './a.ts' } } },
            ],
          },
          { ruleId: 'r' },
        ],
      })
    )
    expect(runs[0]!.results[0]!.path).toBe('a.ts')
    expect(runs[0]!.results[0]!.startLine).toBeNull()
    expect(runs[0]!.results[1]!.path).toBeNull()
  })
})

describe('sarifSeverity / sarifKind / toolSlug', () => {
  const rule = (sev: number | null) => ({
    id: 'r',
    shortDescription: null,
    helpUri: null,
    securitySeverity: sev,
    tags: [],
  })
  const result = (level: 'error' | 'warning' | 'note' | 'none' | null) => ({
    level,
  })
  it('uses security-severity thresholds first, then level', () => {
    expect(sarifSeverity(rule(9), result('note'))).toBe('HIGH')
    expect(sarifSeverity(rule(7), result('note'))).toBe('HIGH')
    expect(sarifSeverity(rule(4), result('note'))).toBe('MEDIUM')
    expect(sarifSeverity(rule(3.9), result('error'))).toBe('LOW')
    expect(sarifSeverity(rule(null), result('error'))).toBe('HIGH')
    expect(sarifSeverity(rule(null), result('warning'))).toBe('MEDIUM')
    expect(sarifSeverity(rule(null), result('note'))).toBe('LOW')
    expect(sarifSeverity(rule(null), result(null))).toBe('LOW')
    expect(sarifSeverity(undefined, result('warning'))).toBe('MEDIUM')
  })
  it('classifies secret tools and secret-tagged rules as SECRET', () => {
    expect(sarifKind('gitleaks', rule(null))).toBe('SECRET')
    expect(sarifKind('TruffleHog', rule(null))).toBe('SECRET')
    expect(sarifKind('Semgrep OSS', { ...rule(null), tags: ['secrets'] })).toBe(
      'SECRET'
    )
    expect(sarifKind('Semgrep OSS', rule(null))).toBe('VULNERABILITY')
  })
  it('slugs tool names', () => {
    expect(toolSlug('Semgrep OSS')).toBe('semgrep-oss')
    expect(toolSlug('')).toBe('unknown')
  })
})

describe('normalizeSarif', () => {
  it('keeps only results on added lines and builds redacted EXTERNAL_TOOL rows', () => {
    const out = normalizeSarif(parseSarif(sarif({})), {
      toolHint: 'semgrep',
      changedLines: changed,
    })
    expect(out.tool).toBe('semgrep-oss')
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toEqual({
      kind: 'VULNERABILITY',
      ruleId: 'ext:semgrep-oss:js.sqli',
      severity: 'HIGH',
      filePath: 'src/db.ts',
      line: 2,
      title: 'SQL built from user input',
      detail: 'Untrusted input reaches $queryRaw',
      evidence: '',
      fingerprint: 'abc123:1',
      externalRef: 'https://sg.run/abc',
    })
    expect(out.dropped).toEqual({ notInDiff: 0, noLocation: 0, duplicate: 0 })
    expect(out.truncated).toBe(false)
  })

  it('drops results outside the diff, keeps line-less results per file, counts both', () => {
    const runs = parseSarif(
      sarif({
        results: [
          {
            ruleId: 'js.sqli',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 99 },
                },
              },
            ],
          },
          {
            ruleId: 'js.sqli',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/untouched.ts' },
                  region: { startLine: 2 },
                },
              },
            ],
          },
          {
            ruleId: 'js.sqli',
            locations: [
              { physicalLocation: { artifactLocation: { uri: 'src/db.ts' } } },
            ],
          },
          { ruleId: 'js.sqli' },
        ],
      })
    )
    const out = normalizeSarif(runs, {
      toolHint: 'semgrep',
      changedLines: changed,
    })
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({ filePath: 'src/db.ts', line: null })
    expect(out.dropped).toEqual({ notInDiff: 2, noLocation: 1, duplicate: 0 })
  })

  it('falls back to the tool hint and the rule id when the run carries no names', () => {
    const runs = parseSarif(
      sarif({
        tool: '',
        rules: [],
        results: [
          {
            ruleId: 'x',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 2 },
                },
              },
            ],
          },
        ],
      })
    )
    const out = normalizeSarif(runs, {
      toolHint: 'Gitleaks',
      changedLines: changed,
    })
    expect(out.tool).toBe('gitleaks')
    expect(out.findings[0]).toMatchObject({
      ruleId: 'ext:gitleaks:x',
      title: 'x',
      detail: 'Reported by Gitleaks.',
      externalRef: null,
      kind: 'SECRET',
    })
  })

  it('RED LINE: a gitleaks-style result never lands the raw secret in any column', () => {
    const runs = parseSarif(
      sarif({
        tool: 'gitleaks',
        rules: [
          {
            id: 'aws-access-key',
            shortDescription: { text: `AWS key ${KEY} detected` },
          },
        ],
        results: [
          {
            ruleId: 'aws-access-key',
            level: 'error',
            message: {
              text: `aws-access-key has detected secret for file src/db.ts. Secret: ${KEY}`,
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: {
                    startLine: 2,
                    snippet: { text: `const k = "${KEY}"` },
                  },
                },
              },
            ],
          },
        ],
      })
    )
    const out = normalizeSarif(runs, {
      toolHint: 'gitleaks',
      changedLines: changed,
    })
    expect(out.findings[0]!.kind).toBe('SECRET')
    expect(JSON.stringify(out.findings)).not.toContain(KEY)
    expect(out.findings[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('dedupes identical fingerprints within one push and truncates past the cap', () => {
    const many = Array.from({ length: MAX_SARIF_FINDINGS + 5 }, (_, i) => ({
      ruleId: 'js.sqli',
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'src/db.ts' },
            region: { startLine: 2, snippet: { text: `stmt ${i}` } },
          },
        },
      ],
    }))
    const out = normalizeSarif(
      parseSarif(sarif({ results: [...many, many[0]!] })),
      { toolHint: 'semgrep', changedLines: changed }
    )
    expect(out.findings).toHaveLength(MAX_SARIF_FINDINGS)
    expect(out.truncated).toBe(true)
    expect(out.dropped.duplicate).toBe(1)
  })
})
