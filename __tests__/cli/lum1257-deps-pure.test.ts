/**
 * @jest-environment node
 */
/**
 * LUM-1257 — the pure parts of `lumo security scan --deps`: the
 * `osv-scanner.toml` ignore reader (expiry included), the npm lockfile delta,
 * CVSS / MAL severity, the fixed-version suggestion, alias grouping and the
 * server's dependency fingerprint.
 */
import * as fs from 'fs'
import * as path from 'path'
import { dependencyFingerprint } from '@/lib/security-scan/redact'
import { lockfileDelta, parseNpmLockfile } from '../../cli/src/lib/npm-lockfile'
import {
  compareVersions,
  cvss3BaseScore,
  fixedVersionFor,
  groupSeverity,
  groupVulns,
  toDependencyFinding,
  type OsvVuln,
} from '../../cli/src/lib/osv-advisory'
import {
  matchIgnore,
  parseOsvIgnores,
  parseTomlDate,
} from '../../cli/src/lib/osv-ignores'
import { npmLock } from '../../cli/test-support/osv-fixtures'

describe('parseOsvIgnores', () => {
  it("reads every [[IgnoredVulns]] of the repository's own osv-scanner.toml", () => {
    const toml = fs.readFileSync(
      path.join(__dirname, '../../osv-scanner.toml'),
      'utf8'
    )
    const ignores = parseOsvIgnores(toml)
    expect(ignores.length).toBeGreaterThanOrEqual(1)
    for (const ig of ignores) {
      expect(ig.id).toMatch(/^GHSA-/)
      expect(ig.until).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(ig.ignoreUntil).toBeInstanceOf(Date)
    }
  })

  it('skips multi-line strings, comments and other tables', () => {
    const toml = [
      '# id = "GHSA-comment"',
      '[[IgnoredVulns]]',
      'id = "GHSA-aaaa" # trailing comment',
      'ignoreUntil = 2027-01-05T10:00:00Z',
      'reason = """',
      'id = "GHSA-inside-reason"',
      '"""',
      '[[PackageOverrides]]',
      'id = "GHSA-not-an-ignore"',
      '[[IgnoredVulns]]',
      "id = 'GHSA-bbbb'",
      "reason = '''one line''' ",
      'id2 = "x"',
    ].join('\n')
    expect(parseOsvIgnores(toml)).toEqual([
      {
        id: 'GHSA-aaaa',
        until: '2027-01-05T10:00:00Z',
        ignoreUntil: new Date('2027-01-05T10:00:00Z'),
      },
      { id: 'GHSA-bbbb', until: null, ignoreUntil: null },
    ])
  })

  it('a bare date is midnight UTC; an unreadable date counts as lapsed', () => {
    expect(parseTomlDate('2027-01-05')?.toISOString()).toBe(
      '2027-01-05T00:00:00.000Z'
    )
    const [ig] = parseOsvIgnores(
      '[[IgnoredVulns]]\nid = "X"\nignoreUntil = "soon"\n'
    )
    expect(ig?.ignoreUntil?.getTime()).toBe(0)
  })
})

describe('matchIgnore (expiry)', () => {
  const ignores = parseOsvIgnores(
    '[[IgnoredVulns]]\nid = "GHSA-x"\nignoreUntil = 2027-01-05\n'
  )

  it('covers the advisory by id or alias while in force', () => {
    const now = new Date('2026-12-31T00:00:00Z')
    expect(matchIgnore(ignores, ['GHSA-x'], now).active?.id).toBe('GHSA-x')
    expect(matchIgnore(ignores, ['CVE-1', 'ghsa-x'], now).active?.id).toBe(
      'GHSA-x'
    )
    expect(matchIgnore(ignores, ['GHSA-y'], now)).toEqual({
      active: null,
      expired: null,
    })
  })

  it('stops covering it once ignoreUntil passes, and says it lapsed', () => {
    const r = matchIgnore(ignores, ['GHSA-x'], new Date('2027-01-05T00:00:01Z'))
    expect(r.active).toBeNull()
    expect(r.expired?.until).toBe('2027-01-05')
  })

  it('no ignoreUntil = no expiry', () => {
    const forever = parseOsvIgnores('[[IgnoredVulns]]\nid = "GHSA-x"\n')
    expect(
      matchIgnore(forever, ['GHSA-x'], new Date('2100-01-01')).active?.id
    ).toBe('GHSA-x')
  })
})

describe('npm lockfile delta', () => {
  it('reads lockfile v3 packages (nested, scoped) and skips the root and links', () => {
    const lock = npmLock({
      lodash: '4.17.21',
      '@babel/traverse': '7.22.0',
      'a/node_modules/lodash': '3.10.1',
    })
    const doc = JSON.parse(lock)
    doc.packages['node_modules/ws-link'] = { resolved: 'cli', link: true }
    doc.packages['cli'] = { name: '@lumoai/cli', version: '1.0.0' }
    expect([...parseNpmLockfile(JSON.stringify(doc)).keys()].sort()).toEqual([
      '@babel/traverse@7.22.0',
      '@lumoai/cli@1.0.0',
      'lodash@3.10.1',
      'lodash@4.17.21',
    ])
  })

  it('reads lockfile v1 nested dependencies, bundled ones included', () => {
    const v1 = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        a: {
          version: '1.0.0',
          dependencies: {
            b: { version: '2.0.0' },
            // Bundled inside a's tarball: installed code all the same.
            c: { version: '3.0.0', bundled: true },
          },
        },
      },
    })
    expect([...parseNpmLockfile(v1).keys()].sort()).toEqual([
      'a@1.0.0',
      'b@2.0.0',
      'c@3.0.0',
    ])
  })

  it('reports added and re-versioned packages, not removals or untouched ones', () => {
    const base = npmLock({ keep: '1.0.0', bump: '1.0.0', gone: '1.0.0' })
    const head = npmLock({ keep: '1.0.0', bump: '1.1.0', fresh: '0.1.0' })
    expect(lockfileDelta(base, head)).toEqual([
      { name: 'bump', version: '1.1.0' },
      { name: 'fresh', version: '0.1.0' },
    ])
  })

  it('a missing or unreadable base means every package is new', () => {
    const head = npmLock({ a: '1.0.0' })
    expect(lockfileDelta(null, head)).toEqual([{ name: 'a', version: '1.0.0' }])
    expect(lockfileDelta('{not json', head)).toEqual([
      { name: 'a', version: '1.0.0' },
    ])
  })

  it('an unreadable head throws (the caller reports it)', () => {
    expect(() => lockfileDelta(null, '<<<<<<< conflict')).toThrow()
  })
})

describe('severity', () => {
  it('computes CVSS v3 base scores', () => {
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(
      9.8
    )
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N')).toBe(
      6.1
    )
    expect(cvss3BaseScore('CVSS:3.0/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L')).toBe(
      3.7
    )
    expect(cvss3BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(
      0
    )
    expect(cvss3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N')).toBeNull()
    expect(cvss3BaseScore('CVSS:3.1/AV:X')).toBeNull()
  })

  it('MAL-* is always HIGH; else CVSS bands; else the database label; else MEDIUM', () => {
    const low: OsvVuln = {
      id: 'GHSA-l',
      severity: [
        {
          type: 'CVSS_V3',
          score: 'CVSS:3.0/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L',
        },
      ],
    }
    expect(groupSeverity(['MAL-2024-1'], [low]).severity).toBe('HIGH')
    expect(groupSeverity(['GHSA-l'], [low])).toEqual({
      severity: 'LOW',
      score: 3.7,
    })
    expect(groupSeverity(['GHSA-l'], [low], 7.2)).toEqual({
      severity: 'HIGH',
      score: 7.2,
    })
    expect(
      groupSeverity(
        ['GHSA-m'],
        [{ id: 'GHSA-m', database_specific: { severity: 'MODERATE' } }]
      ).severity
    ).toBe('MEDIUM')
    expect(groupSeverity(['GHSA-n'], [{ id: 'GHSA-n' }]).severity).toBe(
      'MEDIUM'
    )
  })
})

describe('fixed version', () => {
  const vuln: OsvVuln = {
    id: 'GHSA-35jh-r3h4-6jhm',
    affected: [
      {
        package: { ecosystem: 'npm', name: 'lodash' },
        ranges: [
          {
            type: 'SEMVER',
            events: [{ introduced: '0' }, { fixed: '4.17.21' }],
          },
        ],
      },
      {
        package: { ecosystem: 'npm', name: 'other' },
        ranges: [
          { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '9.9.9' }] },
        ],
      },
    ],
  }

  it('suggests the fix of the range the version is in', () => {
    expect(fixedVersionFor(vuln, 'npm', 'lodash', '4.17.15')).toBe('4.17.21')
    expect(fixedVersionFor(vuln, 'npm', 'lodash', '4.17.21')).toBeNull()
    expect(
      fixedVersionFor(
        {
          id: 'x',
          affected: [
            {
              package: { ecosystem: 'npm', name: 'p' },
              ranges: [
                {
                  type: 'SEMVER',
                  events: [
                    { introduced: '1.0.0' },
                    { fixed: '1.2.0' },
                    { introduced: '2.0.0' },
                    { fixed: '2.0.5' },
                  ],
                },
              ],
            },
          ],
        },
        'npm',
        'p',
        '2.0.1'
      )
    ).toBe('2.0.5')
  })

  it('compares semver with prereleases', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
  })
})

describe('toDependencyFinding', () => {
  const now = new Date('2026-10-19T00:00:00Z')
  const lodashVuln: OsvVuln = {
    id: 'GHSA-35jh-r3h4-6jhm',
    summary: 'Command Injection in lodash',
    aliases: ['CVE-2021-23337'],
    severity: [
      {
        type: 'CVSS_V3',
        score: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H',
      },
    ],
    affected: [
      {
        package: { ecosystem: 'npm', name: 'lodash' },
        ranges: [
          {
            type: 'SEMVER',
            events: [{ introduced: '0' }, { fixed: '4.17.21' }],
          },
        ],
      },
    ],
  }
  const input = {
    ecosystem: 'npm',
    name: 'lodash',
    version: '4.17.15',
    filePath: 'package-lock.json',
    ids: ['GHSA-35jh-r3h4-6jhm'],
    vulns: [lodashVuln],
  }

  it("carries the managed scan's rule id and dependencyFingerprint", () => {
    const r = toDependencyFinding(input, [], now)
    if (!('finding' in r)) throw new Error('expected a finding')
    expect(r.finding).toMatchObject({
      scanner: 'DEPS',
      kind: 'DEPENDENCY',
      ruleId: 'ext:osv-scanner:GHSA-35jh-r3h4-6jhm',
      severity: 'HIGH',
      score: 7.2,
      line: null,
      fixedVersion: '4.17.21',
      malicious: false,
      aliases: ['CVE-2021-23337'],
      title: 'Command Injection in lodash',
      url: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm',
      detail:
        'Package lodash@4.17.15 is vulnerable to GHSA-35jh-r3h4-6jhm (also known as CVE-2021-23337).',
    })
    expect(r.finding.fingerprint).toBe(
      dependencyFingerprint('npm', 'lodash', '4.17.15', 'GHSA-35jh-r3h4-6jhm')
    )
  })

  it('an ignore in force (matched by alias) suppresses it; a lapsed one does not', () => {
    const ignores = parseOsvIgnores(
      '[[IgnoredVulns]]\nid = "CVE-2021-23337"\nignoreUntil = 2027-01-05\n'
    )
    expect(toDependencyFinding(input, ignores, now)).toEqual({
      ignored: {
        osvId: 'GHSA-35jh-r3h4-6jhm',
        package: 'lodash',
        version: '4.17.15',
        until: '2027-01-05',
      },
    })
    const later = toDependencyFinding(input, ignores, new Date('2027-02-01'))
    if (!('finding' in later)) throw new Error('expected a finding')
    expect(later.finding.ignoreExpired).toBe('2027-01-05')
  })

  it('a malicious package is HIGH and says so', () => {
    const r = toDependencyFinding(
      {
        ...input,
        name: 'evil-pkg',
        version: '1.0.0',
        ids: ['MAL-2024-1234'],
        vulns: [{ id: 'MAL-2024-1234', summary: 'Malicious code in evil-pkg' }],
      },
      [],
      now
    )
    if (!('finding' in r)) throw new Error('expected a finding')
    expect(r.finding).toMatchObject({
      severity: 'HIGH',
      malicious: true,
      title: 'Known-malicious package evil-pkg@1.0.0',
    })
  })

  it('groups advisories that alias each other under the first id', () => {
    const groups = groupVulns([
      { id: 'MAL-2024-9', aliases: ['GHSA-zzzz'] },
      { id: 'GHSA-zzzz', aliases: ['MAL-2024-9'] },
      { id: 'GHSA-aaaa' },
    ])
    expect(groups.map(g => g.ids)).toEqual([
      ['GHSA-zzzz', 'MAL-2024-9'],
      ['GHSA-aaaa'],
    ])
  })
})
