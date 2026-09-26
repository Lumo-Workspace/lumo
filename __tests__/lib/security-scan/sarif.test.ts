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
      readFileSync(join(__dirname, '../../fixtures/lum846', name), 'utf8')
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
              join(__dirname, '../../fixtures/lum846/trivy.sarif'),
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
