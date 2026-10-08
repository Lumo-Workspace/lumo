/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkInstalled,
  classifyLicense,
  collectProdPackages,
  exceptionReason,
  fillMissingLicenses,
  findings,
  groupByLicense,
  hasBlockers,
  hasCopyleftAlternative,
  licenseOf,
  normaliseExpr,
  readInstalledPackageJson,
  renderMarkdown,
  resolveDependency,
  sniffLicenseText,
  type LicenseException,
  type Lockfile,
} from '../../scripts/license-audit'

const LOCK: Lockfile = {
  packages: {
    '': {
      name: 'root',
      dependencies: { a: '^1', ws: '*' },
      optionalDependencies: { bin: '^1' },
      devDependencies: {},
    } as Lockfile['packages'][string],
    pkg: { name: '@x/ws', version: '0.1.0', dependencies: { c: '^1' } },
    gone: {
      name: '@x/gone',
      version: '0.0.1',
      extraneous: true,
      dependencies: { missingdep: '^1' },
    },
    'node_modules/ws': { link: true, resolved: 'pkg' },
    'node_modules/a': {
      version: '1.0.0',
      license: 'MIT',
      dependencies: { b: '^2' },
      peerDependencies: { peer: '^1', optpeer: '^1' },
      peerDependenciesMeta: { optpeer: { optional: true } },
    },
    'node_modules/a/node_modules/b': {
      version: '2.0.0',
      license: 'SEE LICENSE IN README.md',
    },
    'node_modules/b': { version: '1.0.0', license: 'GPL-3.0' },
    'node_modules/peer': { version: '1.0.0', license: 'ISC' },
    'node_modules/optpeer': {
      version: '1.0.0',
      license: 'AGPL-3.0',
      dev: true,
    },
    'node_modules/c': { version: '1.0.0', license: 'MPL-2.0 OR Apache-2.0' },
    'node_modules/bin': {
      version: '1.0.0',
      license: 'LGPL-3.0-or-later',
      os: ['linux'],
      cpu: ['x64'],
    },
    'node_modules/devonly': {
      version: '9.9.9',
      license: 'UNLICENSED',
      dev: true,
    },
  },
}

describe('classifyLicense', () => {
  it.each([
    ['MIT', 'permissive'],
    ['(MIT OR CC0-1.0)', 'permissive'],
    ['MPL-2.0 OR Apache-2.0', 'permissive'],
    ['Apache-2.0 AND LGPL-3.0-or-later', 'weak-copyleft'],
    ['MPL-2.0', 'weak-copyleft'],
    ['GPL-2.0-only', 'strong-copyleft'],
    ['AGPL-3.0', 'strong-copyleft'],
    ['GPL-2.0 WITH Classpath-exception-2.0', 'strong-copyleft'],
    ['SEE LICENSE IN README.md', 'non-osi'],
    ['UNLICENSED', 'non-osi'],
    ['BUSL-1.1', 'non-osi'],
    ['CC-BY-4.0', 'non-osi'],
    ['', 'missing'],
    [null, 'missing'],
    // Anything not fully parsed is unknown (and blocks), never the parsed prefix.
    ['MIT garbage', 'unknown'],
    ['MIT)', 'unknown'],
    ['(MIT OR Apache-2.0', 'unknown'],
    ['MIT OR', 'unknown'],
    ['AND MIT', 'unknown'],
    ['GPL-2.0 WITH', 'unknown'],
    ['MIT AND GPL-3.0', 'strong-copyleft'],
    ['(MIT) AND (GPL-3.0)', 'strong-copyleft'],
  ])('%s → %s', (expr, expected) => {
    expect(classifyLicense(expr)).toBe(expected)
  })
})

describe('licenseOf', () => {
  it('reads string, legacy array and missing forms', () => {
    expect(licenseOf({ license: ' MIT ' })).toBe('MIT')
    expect(
      licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })
    ).toBe('(MIT OR Apache-2.0)')
    expect(licenseOf({ licenses: [{ type: 'BSD-3-Clause' }] })).toBe(
      'BSD-3-Clause'
    )
    expect(licenseOf({})).toBeNull()
  })
})

describe('sniffLicenseText', () => {
  it('recognises common LICENSE headers', () => {
    expect(sniffLicenseText('The MIT License (MIT)\n\nCopyright')).toBe('MIT')
    expect(
      sniffLicenseText('   Apache License\n   Version 2.0, January 2004')
    ).toBe('Apache-2.0')
    expect(sniffLicenseText('ISC License\n')).toBe('ISC')
    expect(sniffLicenseText('All rights reserved.')).toBeNull()
  })

  it('ignores boilerplate below the title and reports unknown instead of guessing', () => {
    // A proprietary file that embeds an MIT notice for a vendored helper.
    const proprietary = [
      'Copyright (c) Example Corp. All rights reserved.',
      '',
      'Use of this software requires a commercial agreement.',
      '',
      'Portions derived from left-pad, under the MIT License:',
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
    ].join('\n')
    expect(sniffLicenseText(proprietary)).toBeNull()
    // "MIT License" mentioned mid-line in the title is not a title match either.
    expect(sniffLicenseText('Not under the MIT License; see EULA')).toBeNull()
    // Apache title without the version line is not enough.
    expect(sniffLicenseText('Apache License\nsome fork terms')).toBeNull()
  })
})

describe('resolveDependency', () => {
  it('prefers the nested copy and falls back up the tree', () => {
    expect(resolveDependency(LOCK.packages, 'node_modules/a', 'b')).toBe(
      'node_modules/a/node_modules/b'
    )
    expect(
      resolveDependency(LOCK.packages, 'node_modules/a/node_modules/b', 'peer')
    ).toBe('node_modules/peer')
    expect(resolveDependency(LOCK.packages, 'pkg', 'c')).toBe('node_modules/c')
    expect(resolveDependency(LOCK.packages, '', 'nope')).toBeNull()
  })
})

describe('collectProdPackages', () => {
  const closure = collectProdPackages(LOCK)
  const byPath = new Map(closure.packages.map(p => [p.path, p]))

  it('follows deps, workspace links, optional and required peers but not dev or optional peers', () => {
    expect([...byPath.keys()].sort()).toEqual([
      'node_modules/a',
      'node_modules/a/node_modules/b',
      'node_modules/bin',
      'node_modules/c',
      'node_modules/peer',
    ])
    expect(byPath.get('node_modules/bin')).toMatchObject({
      optionalOnly: true,
      platform: 'linux/x64',
      via: '<root>',
    })
    expect(byPath.get('node_modules/c')!.via).toBe('@x/ws')
    expect(byPath.get('node_modules/a/node_modules/b')!.licenseSource).toBe(
      'lockfile'
    )
  })

  it('LUM-1032: follows an optional peer npm keeps in production (not dev-flagged), as optional', () => {
    const kept = collectProdPackages({
      packages: {
        '': { name: 'root', dependencies: { plugin: '^1' } },
        'node_modules/plugin': {
          version: '1.0.0',
          license: 'MIT',
          peerDependencies: { typescript: '>=5', absent: '^1' },
          peerDependenciesMeta: {
            typescript: { optional: true },
            absent: { optional: true },
          },
        },
        'node_modules/typescript': { version: '5.9.3', license: 'Apache-2.0' },
      },
    })
    expect(kept.packages.map(p => p.path).sort()).toEqual([
      'node_modules/plugin',
      'node_modules/typescript',
    ])
    expect(
      kept.packages.find(p => p.path === 'node_modules/typescript')
    ).toMatchObject({ optionalOnly: true, via: 'plugin' })
    // A missing optional peer is neither followed nor reported.
    expect(kept.unresolved).toEqual([])
  })

  it('skips extraneous workspace roots instead of reporting their deps as unresolved', () => {
    expect(closure.unresolved).toEqual([])
    const broken = collectProdPackages({
      packages: { '': { dependencies: { ghost: '^1' } } },
    })
    expect(broken.unresolved).toEqual(['ghost (required by <root>)'])
    expect(hasBlockers(broken)).toBe(true)
  })
})

describe('fillMissingLicenses', () => {
  it('uses package.json first, then a LICENSE file sniff', () => {
    const pkgs = collectProdPackages({
      packages: {
        '': { dependencies: { x: '1', y: '1', z: '1' } },
        'node_modules/x': { version: '1' },
        'node_modules/y': { version: '1' },
        'node_modules/z': { version: '1' },
      },
    }).packages
    fillMissingLicenses(
      pkgs,
      path => (path === 'node_modules/x' ? { license: 'ISC' } : {}),
      path => (path === 'node_modules/y' ? 'MIT License' : null)
    )
    const lic = Object.fromEntries(
      pkgs.map(p => [p.name, [p.license, p.licenseSource]])
    )
    expect(lic).toEqual({
      x: ['ISC', 'package.json'],
      y: ['MIT', 'LICENSE file'],
      z: [null, null],
    })
  })
})

describe('malformed / unrecognised inputs do not crash the audit', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'license-audit-'))
    mkdirSync(join(dir, 'node_modules/good'), { recursive: true })
    mkdirSync(join(dir, 'node_modules/bad'), { recursive: true })
    mkdirSync(join(dir, 'node_modules/arr'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules/good/package.json'),
      '{"version":"1.0.0","license":"MIT"}'
    )
    writeFileSync(
      join(dir, 'node_modules/bad/package.json'),
      '{"version": "1.0.0", license: MIT'
    )
    writeFileSync(join(dir, 'node_modules/arr/package.json'), '[]')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('readInstalledPackageJson returns parsed / parseError / null', () => {
    expect(readInstalledPackageJson(dir, 'node_modules/good')).toEqual({
      version: '1.0.0',
      license: 'MIT',
    })
    expect(
      readInstalledPackageJson(dir, 'node_modules/bad')!.parseError
    ).toEqual(expect.any(String))
    expect(
      readInstalledPackageJson(dir, 'node_modules/arr')!.parseError
    ).toMatch(/not a JSON object/)
    expect(readInstalledPackageJson(dir, 'node_modules/none')).toBeNull()
  })

  it('still blocks for manual review when package.json is unreadable but the LICENSE title is recognised', () => {
    const closure = collectProdPackages({
      packages: {
        '': { dependencies: { bad: '1' } },
        'node_modules/bad': { version: '1.0.0' },
      },
    })
    fillMissingLicenses(
      closure.packages,
      path => readInstalledPackageJson(dir, path),
      () => 'MIT License\n\nCopyright'
    )
    const [bad] = closure.packages
    expect(bad).toMatchObject({ license: 'MIT', licenseSource: 'LICENSE file' })
    expect(bad!.notes).toEqual([
      expect.stringMatching(/^error: unreadable package.json/),
    ])
    expect(findings(closure.packages)).toEqual([])
    expect(hasBlockers(closure)).toBe(true)
  })

  it('records a broken package.json as an error entry and keeps going', () => {
    const lock: Lockfile = {
      packages: {
        '': { dependencies: { good: '1', bad: '1', odd: '1' } },
        'node_modules/good': { version: '1.0.0' },
        'node_modules/bad': { version: '1.0.0' },
        'node_modules/odd': { version: '1.0.0' },
      },
    }
    const closure = collectProdPackages(lock)
    const read = (path: string) => readInstalledPackageJson(dir, path)
    expect(() =>
      fillMissingLicenses(closure.packages, read, path =>
        path === 'node_modules/odd'
          ? 'Copyright Example Corp.\nAll rights reserved.'
          : null
      )
    ).not.toThrow()
    const byName = Object.fromEntries(closure.packages.map(p => [p.name, p]))
    expect(byName.good!.license).toBe('MIT')
    expect(byName.bad!.license).toBeNull()
    expect(byName.bad!.notes).toEqual([
      expect.stringMatching(/^error: unreadable package.json/),
    ])
    expect(byName.odd!.license).toBeNull()
    expect(byName.odd!.notes).toEqual([
      expect.stringMatching(/^unknown: LICENSE file title not recognised/),
    ])
    expect(hasBlockers(closure)).toBe(true)

    const { drift } = checkInstalled(closure.packages, read)
    expect(drift).toEqual([
      {
        path: 'node_modules/bad',
        issue: expect.stringMatching(/^error: unreadable package.json/),
      },
    ])
    const md = renderMarkdown(closure, { drift, notInstalled: 1 })
    expect(md).toContain('Needs manual review (blocks the audit):')
    expect(md).toContain('- bad@1.0.0: error: unreadable package.json')
    expect(md).toContain(
      '- odd@1.0.0: unknown: LICENSE file title not recognised'
    )
  })
})

describe('checkInstalled', () => {
  it('reports version/license drift and counts packages not installed', () => {
    const pkgs = collectProdPackages(LOCK).packages
    const installed: Record<string, { version: string; license?: string }> = {
      'node_modules/a': { version: 'v1.0.0', license: 'MIT' },
      'node_modules/c': { version: '0.9.0', license: 'MPL-2.0 OR Apache-2.0' },
      'node_modules/peer': { version: '1.0.0', license: 'MIT' },
    }
    const { drift, notInstalled } = checkInstalled(
      pkgs,
      p => installed[p] ?? null
    )
    expect(notInstalled).toBe(2)
    expect(drift).toEqual([
      { path: 'node_modules/c', issue: 'version lock=1.0.0 installed=0.9.0' },
      { path: 'node_modules/peer', issue: 'license lock=ISC installed=MIT' },
    ])
  })
})

describe('findings / exceptions / rendering', () => {
  const closure = collectProdPackages(LOCK)

  it('lists non-permissive items and dual licenses with a copyleft alternative', () => {
    const fs = findings(closure.packages)
    expect(fs.map(f => [f.name, f.category])).toEqual([
      ['b', 'non-osi'],
      ['bin', 'weak-copyleft'],
      ['c', 'permissive'],
    ])
    expect(hasCopyleftAlternative('MPL-2.0 OR Apache-2.0')).toBe(true)
    expect(hasCopyleftAlternative('MIT OR CC0-1.0')).toBe(false)
    expect(hasBlockers(closure)).toBe(true)
  })

  it('knows the reviewed exceptions', () => {
    expect(
      exceptionReason('@img/sharp-libvips-linux-x64', 'LGPL-3.0-or-later')
    ).toMatch(/LGPL/)
    expect(exceptionReason('caniuse-lite', 'CC-BY-4.0')).toMatch(/CC-BY-4.0/)
    expect(exceptionReason('left-pad', 'GPL-3.0')).toBeNull()
  })

  it('needs no exception for a dual license with a permissive choice (dompurify)', () => {
    const closure = collectProdPackages({
      packages: {
        '': { dependencies: { dompurify: '3' } },
        'node_modules/dompurify': {
          version: '3.4.16',
          license: '(MPL-2.0 OR Apache-2.0)',
        },
      },
    })
    const [f] = findings(closure.packages)
    expect(f).toMatchObject({
      name: 'dompurify',
      category: 'permissive',
      accepted: null,
    })
    expect(hasBlockers(closure)).toBe(false)
    expect(renderMarkdown(closure)).toContain(
      'OK (permissive alternative chosen)'
    )
  })

  it('never accepts an unparseable license expression, even via an exception', () => {
    const closure = collectProdPackages({
      packages: {
        '': { dependencies: { x: '1' } },
        'node_modules/x': { version: '1.0.0', license: 'MIT garbage' },
      },
    })
    const anything: LicenseException[] = [
      { name: 'x', license: 'MIT garbage', reason: 'r' },
    ]
    expect(findings(closure.packages, anything)[0]).toMatchObject({
      category: 'unknown',
      accepted: null,
    })
    expect(hasBlockers(closure, anything)).toBe(true)
  })

  it('normaliseExpr only strips parentheses that wrap the whole expression', () => {
    expect(normaliseExpr(' ((lgpl-3.0-or-later)) ')).toBe('LGPL-3.0-OR-LATER')
    expect(normaliseExpr('(MIT) AND (GPL-3.0)')).toBe('(MIT) AND (GPL-3.0)')
    expect(normaliseExpr('((MIT) AND (GPL-3.0))')).toBe('(MIT) AND (GPL-3.0)')
    // The old behaviour made these two compare equal.
    expect(
      exceptionReason('y', 'MIT) AND (GPL-3.0', undefined, [
        { name: 'y', license: '(MIT) AND (GPL-3.0)', reason: 'r' },
      ])
    ).toBeNull()
  })

  it('stops accepting an exception once the package license changes', () => {
    // Reviewed under CC-BY-4.0; a release relicensed to something else is NOT covered.
    expect(exceptionReason('caniuse-lite', 'CC-BY-NC-4.0')).toBeNull()
    expect(
      exceptionReason('@img/sharp-libvips-linux-x64', 'GPL-3.0-or-later')
    ).toBeNull()
    expect(exceptionReason('caniuse-lite', null)).toBeNull()

    const pinned: LicenseException[] = [
      {
        name: 'b',
        license: 'SEE LICENSE IN README.md',
        version: '2.0.0',
        reason: 'reviewed',
      },
      { name: 'bin', license: 'LGPL-3.0-or-later', reason: 'reviewed' },
    ]
    const closure = collectProdPackages(LOCK)
    expect(hasBlockers(closure, pinned)).toBe(false)
    // Version pin: another version of `b` is not covered.
    expect(
      exceptionReason('b', 'SEE LICENSE IN README.md', '2.0.1', pinned)
    ).toBeNull()

    // Same packages, but `bin` now ships under a different license → audit fails again.
    const relicensed = collectProdPackages({
      packages: {
        ...LOCK.packages,
        'node_modules/bin': {
          ...LOCK.packages['node_modules/bin']!,
          license: 'GPL-3.0-only',
        },
      },
    })
    expect(hasBlockers(relicensed, pinned)).toBe(true)
    const md = renderMarkdown(relicensed)
    expect(md).toContain('| bin | 1.0.0 | GPL-3.0-only | strong-copyleft')
    expect(md).toContain('**BLOCKER**')
  })

  it('groups by license and renders a markdown report', () => {
    expect(groupByLicense(closure.packages)[0]).toEqual(['ISC', 1])
    const md = renderMarkdown(closure, {
      drift: [{ path: 'node_modules/c', issue: 'x' }],
      notInstalled: 3,
    })
    expect(md).toContain(
      '| b | 2.0.0 | SEE LICENSE IN README.md | non-osi | a | **BLOCKER** |'
    )
    expect(md).toContain('3 not installed locally')
    expect(md).toContain('- node_modules/c: x')
  })
})

describe('the real package-lock.json (LUM-1016 regression guard)', () => {
  const lock = JSON.parse(
    readFileSync(join(__dirname, '../../package-lock.json'), 'utf8')
  ) as Lockfile
  const closure = collectProdPackages(lock)

  it('keeps the Claude Code packages out of the production tree', () => {
    const names = new Set(closure.packages.map(p => p.name))
    expect(names.has('@anthropic-ai/claude-code')).toBe(false)
    expect(names.has('@anthropic-ai/claude-agent-sdk')).toBe(false)
  })

  it('has no unresolved deps and nothing non-OSI, strong-copyleft or unreviewed in production', () => {
    expect(closure.unresolved).toEqual([])
    const bad = findings(closure.packages).filter(
      f =>
        f.category === 'strong-copyleft' ||
        (f.category !== 'permissive' && f.category !== 'missing' && !f.accepted)
    )
    expect(bad.map(f => `${f.name}@${f.version} ${f.license}`)).toEqual([])
  })

  it('only lacks a lockfile license for packages hand-verified from their LICENSE file', () => {
    // khroma → MIT, @vercel/cli-auth → Apache-2.0 (LICENSE files checked in LUM-1016;
    // the CLI fills these from node_modules). A new entry here needs the same check.
    const missing = closure.packages.filter(p => !p.license).map(p => p.name)
    expect(missing.sort()).toEqual(['@vercel/cli-auth', 'khroma'])
  })

  it('audits dependencies only, not Lumo’s own Elastic-2.0 app or MIT CLI (LUM-1014)', () => {
    expect(lock.packages['']?.license).toBe('Elastic-2.0')
    expect(lock.packages['cli']?.license).toBe('MIT')
    const paths = new Set(closure.packages.map(p => p.path))
    for (const root of ['', 'cli', 'shared'])
      expect(paths.has(root)).toBe(false)
    expect(closure.packages.some(p => p.license === 'Elastic-2.0')).toBe(false)
  })

  it('agrees with npm’s own dev flags in the lockfile', () => {
    const fromFlags = Object.entries(lock.packages)
      .filter(
        ([k, v]) =>
          k.includes('node_modules/') && !v.dev && !v.link && !v.extraneous
      )
      .map(([k]) => k)
      .sort()
    expect(closure.packages.map(p => p.path).sort()).toEqual(fromFlags)
  })
})
