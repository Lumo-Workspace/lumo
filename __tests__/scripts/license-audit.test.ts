/**
 * @jest-environment node
 */
import { readFileSync } from 'fs'
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
  renderMarkdown,
  resolveDependency,
  sniffLicenseText,
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
    expect(exceptionReason('@img/sharp-libvips-linux-x64')).toMatch(/LGPL/)
    expect(exceptionReason('dompurify')).toMatch(/Apache-2.0/)
    expect(exceptionReason('caniuse-lite')).toMatch(/CC-BY-4.0/)
    expect(exceptionReason('left-pad')).toBeNull()
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
