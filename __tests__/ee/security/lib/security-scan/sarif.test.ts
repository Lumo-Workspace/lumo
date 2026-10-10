/**
 * LUM-846 — zizmor and `trivy config` reports through the managed-scan
 * normalizer. The fixtures under `__tests__/fixtures/lum846/` are real tool
 * output (zizmor 1.30.1 `--offline --format sarif`, trivy 0.74.0 `config
 * --severity MEDIUM,HIGH,CRITICAL --format sarif`) over a probe tree with a
 * `pull_request_target` workflow, a root Dockerfile and a Pod with two
 * privileged containers — not hand-written SARIF.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizeSarif, parseSarif } from '@/lib/security-scan/sarif'

function fixture(name: string) {
  return parseSarif(
    JSON.parse(
      readFileSync(join(__dirname, '../../../../fixtures/lum846', name), 'utf8')
    )
  )
}

/** Every line of every file the probe PR added. */
function allAdded(files: Record<string, number>): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  for (const [path, n] of Object.entries(files)) {
    out.set(path, new Set(Array.from({ length: n }, (_, i) => i + 1)))
  }
  return out
}

describe('LUM-846 zizmor SARIF', () => {
  const runs = fixture('zizmor.sarif')

  it('LUM-846 zizmor findings keep the rule id, the workflow path and line, and map level to severity', () => {
    const out = normalizeSarif(runs, {
      toolHint: 'zizmor',
      changedLines: allAdded({ '.github/workflows/ci.yml': 12 }),
    })
    expect(out.tool).toBe('zizmor')
    expect(out.dropped).toEqual({ notInDiff: 0, noLocation: 0, duplicate: 0 })
    const byRule = new Map(out.findings.map(f => [f.ruleId, f]))
    expect([...byRule.keys()].sort()).toEqual([
      'ext:zizmor:zizmor/artipacked',
      'ext:zizmor:zizmor/dangerous-triggers',
      'ext:zizmor:zizmor/excessive-permissions',
      'ext:zizmor:zizmor/template-injection',
      'ext:zizmor:zizmor/unpinned-uses',
    ])
    expect(byRule.get('ext:zizmor:zizmor/template-injection')).toMatchObject({
      kind: 'VULNERABILITY',
      severity: 'HIGH',
      filePath: '.github/workflows/ci.yml',
      line: 12,
      externalRef: 'https://docs.zizmor.sh/audits/#template-injection',
    })
    expect(byRule.get('ext:zizmor:zizmor/dangerous-triggers')).toMatchObject({
      severity: 'HIGH',
      line: 2,
    })
    expect(byRule.get('ext:zizmor:zizmor/artipacked')).toMatchObject({
      severity: 'MEDIUM',
      line: 9,
    })
  })

  it('LUM-846 zizmor keeps only results on lines the PR added', () => {
    const out = normalizeSarif(runs, {
      toolHint: 'zizmor',
      // The PR only touched the `run:` step.
      changedLines: new Map([['.github/workflows/ci.yml', new Set([12])]]),
    })
    expect(out.findings.map(f => f.ruleId)).toEqual([
      'ext:zizmor:zizmor/template-injection',
    ])
    expect(out.dropped.notInDiff).toBe(4)
  })
})

describe('LUM-846 trivy config SARIF', () => {
  const runs = fixture('trivy.sarif')
  const changedLines = allAdded({ Dockerfile: 4, 'deploy/pod.yaml': 14 })

  it('LUM-846 trivy findings are ext:trivy rules with security-severity mapping and file lines', () => {
    const out = normalizeSarif(runs, { toolHint: 'trivy', changedLines })
    expect(out.tool).toBe('trivy')
    expect(out.findings).toHaveLength(15)
    const root = out.findings.find(f => f.ruleId === 'ext:trivy:DS-0002')
    expect(root).toMatchObject({
      kind: 'VULNERABILITY',
      severity: 'HIGH',
      filePath: 'Dockerfile',
      line: 1,
      externalRef: 'https://avd.aquasec.com/misconfig/ds-0002',
    })
    expect(
      out.findings.find(f => f.ruleId === 'ext:trivy:DS-0001')?.severity
    ).toBe('MEDIUM')
  })

  it('LUM-846 trivy detail is the Message line, not the whole Artifact block', () => {
    const out = normalizeSarif(runs, { toolHint: 'trivy', changedLines })
    const root = out.findings.find(f => f.ruleId === 'ext:trivy:DS-0002')!
    expect(root.detail).toBe(
      'Specify at least 1 USER command in Dockerfile with non-root user as argument'
    )
    for (const f of out.findings) expect(f.detail).not.toMatch(/^Artifact:/)
  })

  it('LUM-846 two containers hitting the same trivy rule in one file stay two findings', () => {
    const out = normalizeSarif(runs, { toolHint: 'trivy', changedLines })
    expect(out.dropped.duplicate).toBe(0)
    const privileged = out.findings.filter(
      f => f.ruleId === 'ext:trivy:KSV-0017'
    )
    expect(privileged.map(f => f.line).sort()).toEqual([11, 7])
    expect(new Set(privileged.map(f => f.fingerprint)).size).toBe(2)
  })

  it('LUM-846 trivy fingerprints do not move when the file shifts down', () => {
    const shifted = parseSarif(
      JSON.parse(
        JSON.stringify(
          JSON.parse(
            readFileSync(
              join(__dirname, '../../../../fixtures/lum846/trivy.sarif'),
              'utf8'
            )
          ),
          (k, v) => (k === 'startLine' || k === 'endLine' ? v + 3 : v)
        )
      )
    )
    const before = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: null,
    })
    const after = normalizeSarif(shifted, {
      toolHint: 'trivy',
      changedLines: null,
    })
    expect(after.findings.map(f => f.fingerprint).sort()).toEqual(
      before.findings.map(f => f.fingerprint).sort()
    )
  })

  it('LUM-846 a baseline built from main reads the same trivy hit as persisting and the new container as new', () => {
    // main had only the `web` container; the PR adds `sidecar`. `persisting`
    // is baseline membership by fingerprint (security-sarif-ingest.service).
    const mainOnly = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: null,
    }).findings.filter(f => !/sidecar/.test(f.detail))
    const baseline = new Set(mainOnly.map(f => f.fingerprint))
    const pr = normalizeSarif(runs, { toolHint: 'trivy', changedLines })
    const privileged = pr.findings.filter(
      f => f.ruleId === 'ext:trivy:KSV-0017'
    )
    const verdict = privileged.map(f => [f.line, baseline.has(f.fingerprint)])
    expect(verdict.sort()).toEqual([
      [11, false],
      [7, true],
    ])
  })
})

describe('LUM-850 rule titles', () => {
  const zizmorRaw = () =>
    JSON.parse(
      readFileSync(
        join(__dirname, '../../../../fixtures/lum846/zizmor.sarif'),
        'utf8'
      )
    )
  const all = allAdded({ '.github/workflows/ci.yml': 12 })

  it('LUM-850 zizmor titles are the rule help text, not the bare rule id', () => {
    const out = normalizeSarif(fixture('zizmor.sarif'), {
      toolHint: 'zizmor',
      changedLines: all,
    })
    const titles = new Map(out.findings.map(f => [f.ruleId, f.title]))
    expect(titles.get('ext:zizmor:zizmor/template-injection')).toBe(
      'code injection via template expansion'
    )
    expect(titles.get('ext:zizmor:zizmor/artipacked')).toBe(
      'credential persistence through GitHub Actions artifacts'
    )
    for (const f of out.findings) {
      expect(f.title).not.toMatch(/^zizmor\//)
    }
  })

  it('LUM-850 title fallback keeps shortDescription on trivy', () => {
    const out = normalizeSarif(fixture('trivy.sarif'), {
      toolHint: 'trivy',
      changedLines: null,
    })
    expect(
      out.findings.find(f => f.ruleId === 'ext:trivy:DS-0001')?.title
    ).toBe("':latest' tag used")
  })

  it('LUM-850 title fallback keeps shortDescription on gitleaks and osv-scanner', () => {
    // Both tools also ship fullDescription / help; shortDescription must win.
    const run = (
      name: string,
      rule: Record<string, unknown>,
      message: string,
      uri: string
    ) =>
      normalizeSarif(
        parseSarif({
          version: '2.1.0',
          runs: [
            {
              tool: { driver: { name, rules: [rule] } },
              results: [
                {
                  ruleId: rule['id'],
                  message: { text: message },
                  locations: [
                    {
                      physicalLocation: {
                        artifactLocation: { uri },
                        region: { startLine: 1, snippet: { text: 'x' } },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { toolHint: name, changedLines: null }
      ).findings
    const gitleaks = run(
      'gitleaks',
      {
        id: 'generic-api-key',
        shortDescription: { text: 'Detected a Generic API Key' },
        fullDescription: { text: 'Full gitleaks description' },
        help: { text: 'gitleaks help' },
      },
      'generic-api-key has detected secret for file src/a.ts',
      'src/a.ts'
    )
    expect(gitleaks.map(f => f.title)).toEqual(['Detected a Generic API Key'])
    const osv = run(
      'osv-scanner',
      {
        id: 'GHSA-35jh-r3h4-6jhm',
        shortDescription: { text: 'GHSA-35jh-r3h4-6jhm: lodash' },
        fullDescription: { text: 'Command Injection in lodash' },
        help: { text: '**Your dependency is vulnerable**' },
      },
      "Package 'lodash@4.17.15' is vulnerable to 'GHSA-35jh-r3h4-6jhm'.",
      'package-lock.json'
    )
    expect(osv.map(f => f.title)).toEqual(['GHSA-35jh-r3h4-6jhm: lodash'])
  })

  it('LUM-850 title fallback order is shortDescription, fullDescription, help text, rule id', () => {
    const doc = (rules: unknown[]) =>
      parseSarif({
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'semgrep', rules } },
            results: rules.map(r => ({
              ruleId: (r as { id: string }).id,
              message: { text: 'm' },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: 'a.ts' },
                    region: { startLine: 1, snippet: { text: 'x' } },
                  },
                },
              ],
            })),
          },
        ],
      })
    const out = normalizeSarif(
      doc([
        {
          id: 'short',
          shortDescription: { text: 'Short' },
          fullDescription: { text: 'Full' },
          help: { text: 'Help' },
        },
        {
          id: 'full',
          fullDescription: { text: 'Full sentence.\nSecond line' },
          help: { text: 'Help' },
        },
        {
          id: 'help',
          shortDescription: { text: '  ' },
          help: { text: 'Help text\n\nmore' },
        },
        { id: 'bare', name: 'bare-name' },
      ]),
      { toolHint: 'semgrep', changedLines: null }
    )
    expect(out.findings.map(f => [f.ruleId.split(':').pop(), f.title])).toEqual(
      [
        ['short', 'Short'],
        ['full', 'Full sentence.'],
        ['help', 'Help text'],
        ['bare', 'bare'],
      ]
    )
  })

  it('LUM-850 fingerprints ignore the title', () => {
    const stripped = zizmorRaw()
    for (const r of stripped.runs[0].tool.driver.rules) {
      delete r.help
      delete r.shortDescription
      delete r.fullDescription
    }
    const fp = (runs: ReturnType<typeof parseSarif>) =>
      normalizeSarif(runs, { toolHint: 'zizmor', changedLines: all })
        .findings.map(f => `${f.ruleId}|${f.fingerprint}`)
        .sort()
    const withTitles = normalizeSarif(fixture('zizmor.sarif'), {
      toolHint: 'zizmor',
      changedLines: all,
    })
    const bare = normalizeSarif(parseSarif(stripped), {
      toolHint: 'zizmor',
      changedLines: all,
    })
    expect(bare.findings.map(f => f.title)).not.toEqual(
      withTitles.findings.map(f => f.title)
    )
    expect(fp(parseSarif(stripped))).toEqual(fp(fixture('zizmor.sarif')))
  })
})
