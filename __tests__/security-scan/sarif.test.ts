/** @jest-environment node */
import {
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  sarifSeverity,
  sarifKind,
  toolSlug,
  isSupplyChainTool,
  parseDependencyMessage,
  ecosystemOfLockfile,
  MAX_SARIF_FINDINGS,
} from '@/lib/security-scan/sarif'
import { addedLinesWithNumbers } from '@/lib/security-scan/diff-lines'
import { dependencyFingerprint } from '@/lib/security-scan/redact'

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
    // The reason is fixed text — it must never echo the document's own
    // `version`, which is attacker-controlled and ends up on the scan row
    // and in logs (LUM-735 review).
    expect(() =>
      parseSarif(sarif({ version: '<script>alert(1)</script>' }))
    ).toThrow('Unsupported SARIF: version is not 2.1.0')
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

  it("lists every run's tool slug in `tools`, even a run with zero surviving results", () => {
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
              name: 'Gitleaks',
              rules: [{ id: 'aws-key' }],
            },
          },
          results: [
            {
              // Outside the diff — dropped, so this run contributes zero
              // findings, but its tool slug must still show up in `tools`.
              ruleId: 'aws-key',
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'src/db.ts' },
                    region: { startLine: 99 },
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
    expect(out.findings.map(f => f.ruleId)).toEqual(['ext:semgrep-oss:js.sqli'])
    expect(out.tools).toEqual(['semgrep-oss', 'gitleaks'])
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

// ── LUM-738: osv-scanner → DEPENDENCY findings ──────────────────────────────

/** The SARIF shape osv-scanner 2.x writes (internal/output/sarif.go). */
function osvSarif(over: { results?: unknown[]; rules?: unknown[] } = {}) {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'osv-scanner',
            rules: over.rules ?? [
              {
                id: 'GHSA-35jh-r3h4-6jhm',
                name: 'GHSA-35jh-r3h4-6jhm',
                shortDescription: {
                  text: 'GHSA-35jh-r3h4-6jhm: Command injection in lodash',
                },
                properties: { 'security-severity': '7.2' },
              },
              {
                id: 'MAL-2024-1234',
                name: 'MAL-2024-1234',
                shortDescription: { text: 'MAL-2024-1234: Malicious code' },
              },
              {
                id: 'GHSA-low',
                shortDescription: { text: 'GHSA-low: minor' },
                properties: { 'security-severity': '3.1' },
              },
            ],
          },
        },
        results: over.results ?? [
          {
            ruleId: 'GHSA-35jh-r3h4-6jhm',
            level: 'warning',
            message: {
              text: "Package 'lodash@4.17.15' is vulnerable to 'GHSA-35jh-r3h4-6jhm' (also known as 'CVE-2021-23337').",
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'package-lock.json' },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'a'.repeat(64) },
          },
          {
            ruleId: 'MAL-2024-1234',
            level: 'warning',
            message: {
              text: "Package 'evil-pkg@1.0.0' is vulnerable to 'MAL-2024-1234'.",
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'package-lock.json' },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'b'.repeat(64) },
          },
          {
            ruleId: 'GHSA-low',
            level: 'warning',
            message: { text: 'unparseable message' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'requirements.txt' },
                },
              },
            ],
            partialFingerprints: { primaryLocationLineHash: 'c'.repeat(64) },
          },
        ],
      },
    ],
  }
}

describe('LUM-738 dependency fingerprint — osv-scanner normalization', () => {
  it('recognises osv-scanner as a supply-chain tool and parses its message', () => {
    expect(isSupplyChainTool('osv-scanner')).toBe(true)
    expect(isSupplyChainTool('OSV-Scanner')).toBe(true)
    expect(isSupplyChainTool('semgrep')).toBe(false)
    expect(
      parseDependencyMessage(
        "Package 'lodash@4.17.15' is vulnerable to 'GHSA-35jh-r3h4-6jhm' (also known as 'CVE-2021-23337')."
      )
    ).toEqual({
      name: 'lodash',
      version: '4.17.15',
      osvId: 'GHSA-35jh-r3h4-6jhm',
    })
    // Scoped npm packages keep their leading @; the version is after the LAST @.
    expect(
      parseDependencyMessage(
        "Package '@babel/traverse@7.22.0' is vulnerable to 'GHSA-67hx-6x53-jw92'."
      )
    ).toEqual({
      name: '@babel/traverse',
      version: '7.22.0',
      osvId: 'GHSA-67hx-6x53-jw92',
    })
    expect(parseDependencyMessage('unparseable message')).toBeNull()
    expect(parseDependencyMessage(null)).toBeNull()
  })

  it('maps lockfile paths to OSV ecosystems and falls back to "unknown"', () => {
    expect(ecosystemOfLockfile('package-lock.json')).toBe('npm')
    expect(ecosystemOfLockfile('apps/web/pnpm-lock.yaml')).toBe('npm')
    expect(ecosystemOfLockfile('yarn.lock')).toBe('npm')
    expect(ecosystemOfLockfile('requirements.txt')).toBe('PyPI')
    expect(ecosystemOfLockfile('requirements-dev.txt')).toBe('PyPI')
    expect(ecosystemOfLockfile('poetry.lock')).toBe('PyPI')
    expect(ecosystemOfLockfile('uv.lock')).toBe('PyPI')
    expect(ecosystemOfLockfile('go.mod')).toBe('Go')
    expect(ecosystemOfLockfile('Cargo.lock')).toBe('crates.io')
    expect(ecosystemOfLockfile('Gemfile.lock')).toBe('RubyGems')
    expect(ecosystemOfLockfile('composer.lock')).toBe('Packagist')
    expect(ecosystemOfLockfile('pom.xml')).toBe('Maven')
    expect(ecosystemOfLockfile('something.weird')).toBe('unknown')
  })

  it('fingerprints a dependency as sha256(ecosystem:name:version:osvId), stable across pushes and lockfile location', () => {
    const out = normalizeSarif(parseSarif(osvSarif()), {
      toolHint: 'osv-scanner',
      changedLines: changed,
    })
    const lodash = out.findings.find(f =>
      f.ruleId.endsWith('GHSA-35jh-r3h4-6jhm')
    )!
    expect(lodash.fingerprint).toBe(
      dependencyFingerprint('npm', 'lodash', '4.17.15', 'GHSA-35jh-r3h4-6jhm')
    )
    expect(lodash.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    // Not the tool's own hash (which bakes in the lockfile path).
    expect(lodash.fingerprint).not.toBe('a'.repeat(64))
    // The same message on a later push / from the baseline yields the same key.
    const again = normalizeSarif(parseSarif(osvSarif()), {
      toolHint: 'osv-scanner',
      changedLines: null,
    })
    expect(
      again.findings.find(f => f.ruleId.endsWith('GHSA-35jh-r3h4-6jhm'))!
        .fingerprint
    ).toBe(lodash.fingerprint)
  })

  it('falls back to the tool fingerprint when the message cannot be parsed', () => {
    const out = normalizeSarif(parseSarif(osvSarif()), {
      toolHint: 'osv-scanner',
      changedLines: changed,
    })
    const low = out.findings.find(f => f.ruleId.endsWith('GHSA-low'))!
    expect(low.fingerprint).toBe('c'.repeat(64))
  })

  it('LUM-738 osv-scanner findings are DEPENDENCY, never diff-filtered, MAL-* is HIGH, CVSS maps severity, and link to osv.dev', () => {
    // `changed` covers only src/db.ts — a diff-aware VULNERABILITY on
    // package-lock.json would be dropped; a DEPENDENCY must survive.
    const out = normalizeSarif(parseSarif(osvSarif()), {
      toolHint: 'osv-scanner',
      changedLines: changed,
    })
    expect(out.tool).toBe('osv-scanner')
    expect(out.dropped.notInDiff).toBe(0)
    expect(
      out.findings.map(f => [f.kind, f.ruleId, f.severity, f.line])
    ).toEqual([
      ['DEPENDENCY', 'ext:osv-scanner:GHSA-35jh-r3h4-6jhm', 'HIGH', null],
      ['DEPENDENCY', 'ext:osv-scanner:MAL-2024-1234', 'HIGH', null],
      ['DEPENDENCY', 'ext:osv-scanner:GHSA-low', 'LOW', null],
    ])
    expect(out.findings[0]).toMatchObject({
      filePath: 'package-lock.json',
      title: 'GHSA-35jh-r3h4-6jhm: Command injection in lodash',
      detail: expect.stringContaining('lodash@4.17.15'),
      evidence: '',
      externalRef: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm',
    })
    // A rule with no CVSS score and no MAL prefix falls back to the SARIF level.
    expect(out.findings[2]!.externalRef).toBe(
      'https://osv.dev/vulnerability/GHSA-low'
    )
  })

  it('LUM-738 baseline mode (changedLines: null) keeps every located result of every tool', () => {
    const out = normalizeSarif(parseSarif(sarif({})), {
      toolHint: 'semgrep',
      changedLines: null,
    })
    expect(out.findings).toHaveLength(1)
    expect(out.dropped.notInDiff).toBe(0)
    const outOfDiff = normalizeSarif(
      parseSarif(
        sarif({
          results: [
            {
              ruleId: 'js.sqli',
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'elsewhere.ts' },
                    region: { startLine: 400 },
                  },
                },
              ],
            },
          ],
        })
      ),
      { toolHint: 'semgrep', changedLines: null }
    )
    expect(outOfDiff.findings.map(f => f.filePath)).toEqual(['elsewhere.ts'])
  })
})
