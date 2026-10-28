/**
 * @jest-environment node
 *
 * LUM-1321 — `lumo security import` reads either SARIF 2.1.0 or the small
 * Lumo JSON an agent writes after a security review, and sends SARIF with
 * repo-relative paths. Every rejection names what to fix.
 */
import {
  AGENT_REVIEW_MAX_FINDINGS,
  detectAgentTool,
  toImportSarif,
} from '../../cli/src/lib/agent-review-format'

const ROOT = '/work/app'

type SarifOut = {
  version: string
  runs: Array<{
    tool: {
      driver: {
        name: string
        rules: Array<{ id: string; shortDescription?: { text: string } }>
      }
    }
    results: Array<{
      ruleId: string
      level: string
      message: { text: string }
      properties?: Record<string, unknown>
      locations: Array<{
        physicalLocation: {
          artifactLocation: { uri: string }
          region?: { startLine: number }
        }
      }>
    }>
  }>
}

const convert = (doc: unknown) => toImportSarif(JSON.stringify(doc), ROOT)
const ok = (doc: unknown): { sarif: SarifOut; results: number } => {
  const out = convert(doc)
  if (!out.ok) throw new Error(out.error)
  return { sarif: out.sarif as SarifOut, results: out.results }
}

describe('Lumo JSON', () => {
  it('converts findings to one SARIF run with severity, rule and location', () => {
    const { sarif, results } = ok({
      findings: [
        {
          file: 'app/api/x/route.ts',
          line: 12,
          severity: 'high',
          title: 'SQL injection in search',
          detail: 'q reaches prisma.$queryRawUnsafe',
          rule: 'sql-injection',
        },
        { file: 'lib/a.ts', line: 3, severity: 'Low', title: 'Verbose error' },
      ],
    })
    expect(results).toBe(2)
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs).toHaveLength(1)
    const [a, b] = sarif.runs[0]!.results
    expect(a).toMatchObject({
      ruleId: 'sql-injection',
      level: 'error',
      // The comment heads with the rule's title; the message adds the detail only.
      message: { text: 'q reaches prisma.$queryRawUnsafe' },
      properties: { 'security-severity': '8.0' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'app/api/x/route.ts' },
            region: { startLine: 12 },
          },
        },
      ],
    })
    // No rule given: a stable slug of the title, so a re-import keeps the fingerprint.
    expect(b).toMatchObject({
      ruleId: 'verbose-error',
      level: 'note',
      message: { text: 'Verbose error' },
    })
    expect(sarif.runs[0]!.tool.driver.rules).toEqual(
      expect.arrayContaining([
        {
          id: 'sql-injection',
          shortDescription: { text: 'SQL injection in search' },
        },
        { id: 'verbose-error', shortDescription: { text: 'Verbose error' } },
      ])
    )
  })

  it('a rule shared by differently titled findings is described by its name; each message leads with its title', () => {
    const { sarif } = ok({
      findings: [
        {
          file: 'a.ts',
          line: 1,
          severity: 'high',
          title: 'exec in thumb',
          detail: 'd1',
          rule: 'command_injection',
        },
        {
          file: 'a.ts',
          line: 9,
          severity: 'high',
          title: 'exec in backup',
          rule: 'command_injection',
        },
      ],
    })
    expect(sarif.runs[0]!.tool.driver.rules).toEqual([
      {
        id: 'command-injection',
        shortDescription: { text: 'Command injection' },
      },
    ])
    expect(sarif.runs[0]!.results.map(r => r.message.text)).toEqual([
      'exec in thumb\n\nd1',
      'exec in backup',
    ])
  })

  it('accepts a bare array, critical as high, and an absolute path inside the repository', () => {
    const { sarif } = ok([
      { file: `${ROOT}/lib/a.ts`, line: 1, severity: 'critical', title: 'x' },
    ])
    const r = sarif.runs[0]!.results[0]!
    expect(r.level).toBe('error')
    expect(r.locations[0]!.physicalLocation.artifactLocation.uri).toBe(
      'lib/a.ts'
    )
  })

  it('accepts an empty list (a clean review clears the earlier import)', () => {
    expect(ok({ findings: [] }).results).toBe(0)
  })

  it.each([
    ['not JSON', 'nope', /not valid JSON/],
    ['an object without findings', { items: [] }, /findings/],
    [
      'a finding without a file',
      { findings: [{ line: 1, severity: 'high', title: 't' }] },
      /findings\[0\]\.file/,
    ],
    [
      'a line below 1',
      { findings: [{ file: 'a.ts', line: 0, severity: 'high', title: 't' }] },
      /findings\[0\]\.line/,
    ],
    [
      'an unknown severity',
      { findings: [{ file: 'a.ts', line: 1, severity: 'urgent', title: 't' }] },
      /findings\[0\]\.severity/,
    ],
    [
      'an empty title',
      { findings: [{ file: 'a.ts', line: 1, severity: 'low', title: ' ' }] },
      /findings\[0\]\.title/,
    ],
    [
      'a path outside the repository',
      {
        findings: [
          { file: '/etc/passwd', line: 1, severity: 'low', title: 't' },
        ],
      },
      /outside the repository/,
    ],
    [
      'a path climbing out',
      { findings: [{ file: '../x.ts', line: 1, severity: 'low', title: 't' }] },
      /outside the repository/,
    ],
  ])('rejects %s', (_name, doc, message) => {
    const out =
      typeof doc === 'string' ? toImportSarif(doc, ROOT) : convert(doc)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(message)
  })

  it(`rejects more than ${AGENT_REVIEW_MAX_FINDINGS} findings`, () => {
    const many = Array.from(
      { length: AGENT_REVIEW_MAX_FINDINGS + 1 },
      (_, i) => ({
        file: 'a.ts',
        line: i + 1,
        severity: 'low',
        title: 't',
      })
    )
    const out = convert({ findings: many })
    expect(out.ok).toBe(false)
  })
})

describe('SARIF', () => {
  const sarif = (uri: string) => ({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'Codex Security' } },
        results: [
          {
            ruleId: 'idor',
            message: { text: 'm' },
            locations: [{ physicalLocation: { artifactLocation: { uri } } }],
          },
          {
            ruleId: 'xss',
            message: { text: 'm' },
            locations: [
              { physicalLocation: { artifactLocation: { uri: 'b.ts' } } },
            ],
          },
        ],
      },
    ],
  })

  it('passes it through, counting results and making file URIs repo-relative', () => {
    const { sarif: out, results } = ok(sarif(`file://${ROOT}/app/page.tsx`))
    expect(results).toBe(2)
    expect(
      out.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation
        .uri
    ).toBe('app/page.tsx')
    expect(
      out.runs[0]!.results[1]!.locations[0]!.physicalLocation.artifactLocation
        .uri
    ).toBe('b.ts')
  })

  it('rejects another SARIF version', () => {
    const out = convert({ ...sarif('a.ts'), version: '2.0.0' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/SARIF 2\.1\.0/)
  })
})

describe('detectAgentTool', () => {
  it('reads Codex first (its shells may inherit a Claude Code id), then Claude Code', () => {
    expect(
      detectAgentTool({ CODEX_THREAD_ID: 't', CLAUDE_CODE_SESSION_ID: 's' })
    ).toBe('codex')
    expect(detectAgentTool({ CODEX_SESSION_ID: 's' })).toBe('codex')
    expect(detectAgentTool({ CLAUDE_CODE_SESSION_ID: 's' })).toBe('claude-code')
    expect(detectAgentTool({})).toBeNull()
  })
})
