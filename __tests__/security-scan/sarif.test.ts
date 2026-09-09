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
  it('parses security-severity supplied as a JSON number', () => {
    const runs = parseSarif(
      sarif({
        rules: [{ id: 'r', properties: { 'security-severity': 8.5 } }],
      })
    )
    const rule = runs[0]!.rules.get('r')!
    expect(rule.securitySeverity).toBe(8.5)
    expect(sarifSeverity(rule, { level: null })).toBe('HIGH')
  })
  it('classifies a singular "secret" tag as SECRET', () => {
    expect(sarifKind('Semgrep OSS', { ...rule(null), tags: ['secret'] })).toBe(
      'SECRET'
    )
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

  it('trusts a tool-supplied fingerprint only when it matches the safe shape', () => {
    const build = (hash: string) =>
      normalizeSarif(
        parseSarif(
          sarif({
            results: [
              {
                ruleId: 'js.sqli',
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
                partialFingerprints: { primaryLocationLineHash: hash },
              },
            ],
          })
        ),
        { toolHint: 'semgrep', changedLines: changed }
      )

    expect(build('abc123:1').findings[0]!.fingerprint).toBe('abc123:1')

    const tooLong = 'a'.repeat(200)
    expect(build(tooLong).findings[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/)

    const withSpace = 'abc 123'
    expect(build(withSpace).findings[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/)

    const withQuote = 'abc"123'
    expect(build(withQuote).findings[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('dedupes on rule+fingerprint so two rules sharing a line-hash both survive', () => {
    const runs = parseSarif(
      sarif({
        rules: [
          { id: 'rule-a', shortDescription: { text: 'Rule A' } },
          { id: 'rule-b', shortDescription: { text: 'Rule B' } },
        ],
        results: [
          {
            ruleId: 'rule-a',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 2 },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'same-hash' },
          },
          {
            ruleId: 'rule-b',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 2 },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'same-hash' },
          },
          {
            ruleId: 'rule-a',
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'src/db.ts' },
                  region: { startLine: 2 },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'same-hash' },
          },
        ],
      })
    )
    const out = normalizeSarif(runs, {
      toolHint: 'semgrep',
      changedLines: changed,
    })
    expect(out.findings).toHaveLength(2)
    expect(out.findings.map(f => f.ruleId).sort()).toEqual([
      'ext:semgrep-oss:rule-a',
      'ext:semgrep-oss:rule-b',
    ])
    expect(out.dropped.duplicate).toBe(1)
  })

  it("prefixes each run ruleId with that run's own tool slug", () => {
    const doc = {
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'Semgrep OSS',
              rules: [{ id: 'js.sqli' }],
            },
          },
          results: [
            {
              ruleId: 'js.sqli',
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
        },
        {
          tool: {
            driver: {
              name: 'gitleaks',
              rules: [{ id: 'aws-key' }],
            },
          },
          results: [
            {
              ruleId: 'aws-key',
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
        },
      ],
    }
    const out = normalizeSarif(parseSarif(doc), {
      toolHint: 'unused',
      changedLines: changed,
    })
    expect(out.tool).toBe('semgrep-oss')
    expect(out.findings.map(f => f.ruleId).sort()).toEqual([
      'ext:gitleaks:aws-key',
      'ext:semgrep-oss:js.sqli',
    ])
  })

  it('redacts a secret before slicing to MAX_DETAIL_CHARS, even when the secret straddles the cut', () => {
    // Key starts right after 986 chars, so a naive slice(0, 1000) BEFORE
    // redaction would keep only the first 14 raw chars of the 20-char key —
    // too short to match the full AKIA pattern, so it would leak unredacted.
    const prefix = 'a'.repeat(986)
    const messageText = `${prefix} ${KEY} ${'b'.repeat(50)}`
    const runs = parseSarif(
      sarif({
        tool: 'gitleaks',
        rules: [{ id: 'aws-key' }],
        results: [
          {
            ruleId: 'aws-key',
            message: { text: messageText },
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
      toolHint: 'gitleaks',
      changedLines: changed,
    })
    expect(out.findings[0]!.detail).not.toContain('AKIAABCDEFGHIJ')
    expect(out.findings[0]!.detail.length).toBeLessThanOrEqual(1000)
  })

  it('keeps an http(s) helpUri as externalRef but rejects other schemes', () => {
    const build = (helpUri: string) =>
      normalizeSarif(
        parseSarif(
          sarif({
            rules: [{ id: 'js.sqli', helpUri }],
          })
        ),
        { toolHint: 'semgrep', changedLines: changed }
      )
    expect(build('javascript:alert(1)').findings[0]!.externalRef).toBeNull()
    expect(build('https://sg.run/abc').findings[0]!.externalRef).toBe(
      'https://sg.run/abc'
    )
  })
})
