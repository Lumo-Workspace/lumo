/**
 * Production dependency license audit (LUM-1016).
 *
 * Walks the PRODUCTION dependency closure (direct + transitive) straight out of
 * `package-lock.json` — the same tree `npm ls --omit=dev --all` reports, but
 * including platform-specific optional binaries for every OS/CPU (a Linux
 * self-host installs different `@img/*` / `@esbuild/*` packages than a Mac dev
 * box, so the lockfile, not the local node_modules, is the right source).
 *
 * Roots = the root package + every workspace (`shared`, `agent-server`, `cli`),
 * following `dependencies`, `optionalDependencies` and non-optional
 * `peerDependencies`. `devDependencies` are never followed.
 *
 * Each package's license comes from the lockfile `license` field, falling back
 * to `node_modules/<path>/package.json`. With `--check-node-modules` it also
 * cross-checks the installed copy (version + license) and reports mismatches —
 * node_modules can lag package.json.
 *
 * Usage:
 *   npx tsx scripts/license-audit.ts                       # markdown summary to stdout
 *   npx tsx scripts/license-audit.ts --json                # full inventory as JSON
 *   npx tsx scripts/license-audit.ts --check-node-modules  # + installed-copy drift
 *
 * Exit code: 1 when a non-permissive item that is NOT in ACCEPTED_EXCEPTIONS is
 * found (or a required dependency cannot be resolved), else 0.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export type LockEntry = {
  name?: string
  version?: string
  license?: string
  licenses?: Array<{ type?: string }> | string
  link?: boolean
  extraneous?: boolean
  resolved?: string
  dev?: boolean
  optional?: boolean
  os?: string[]
  cpu?: string[]
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

export type Lockfile = { packages: Record<string, LockEntry> }

export type LicenseCategory =
  | 'permissive'
  | 'weak-copyleft'
  | 'strong-copyleft'
  | 'non-osi'
  | 'missing'

export type ProdPackage = {
  name: string
  version: string
  /** Lockfile path, e.g. `node_modules/a/node_modules/b`. */
  path: string
  license: string | null
  /** Where `license` came from; LICENSE-file sniffing is the last resort. */
  licenseSource: 'lockfile' | 'package.json' | 'LICENSE file' | null
  /** True when only reachable through optionalDependencies (e.g. per-platform binaries). */
  optionalOnly: boolean
  platform: string | null
  /** First package that pulled this in (`<root>` for direct deps). */
  via: string
}

/** Licenses treated as permissive (OSI-approved or public-domain-equivalent). */
const PERMISSIVE = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'Zlib',
  'PSF-2.0',
])
// Note: CC-BY-* (content licenses) and WTFPL are free but not OSI-approved, so
// they classify as `non-osi` and need an explicit ACCEPTED_EXCEPTIONS entry.

const WEAK_COPYLEFT = /^(MPL-|LGPL-|EPL-|CDDL-)/
const STRONG_COPYLEFT = /^(GPL-|AGPL-|SSPL|EUPL-|OSL-)/

/**
 * Items reviewed by hand and accepted, keyed by package name. Keep each reason
 * short and factual; the audit fails on anything non-permissive not listed here.
 */
export const ACCEPTED_EXCEPTIONS: Record<string, string> = {
  dompurify:
    'Dual-licensed MPL-2.0 OR Apache-2.0; we take Apache-2.0 (permissive).',
  'caniuse-lite':
    'Browser-support DATA (CC-BY-4.0, attribution) consumed at build time by autoprefixer/browserslist; not linked code. Ubiquitous in the npm ecosystem.',
}

/** Name-prefix exceptions (platform binaries ship as many sibling packages). */
export const ACCEPTED_EXCEPTION_PREFIXES: Array<{
  prefix: string
  reason: string
}> = [
  {
    prefix: '@img/sharp-libvips-',
    reason:
      'Prebuilt libvips shared library loaded by sharp (Next.js image optimizer, optional). LGPL-3.0 permits dynamic linking; unmodified binary, source at github.com/lovell/sharp-libvips.',
  },
  {
    prefix: '@img/sharp-wasm32',
    reason:
      'WASM build of sharp+libvips (Apache-2.0 AND LGPL-3.0-or-later); same reasoning as @img/sharp-libvips-*.',
  },
  {
    prefix: '@img/sharp-win32-',
    reason:
      'Windows sharp build bundling libvips (Apache-2.0 AND LGPL-3.0-or-later); same reasoning as @img/sharp-libvips-*.',
  },
]

export function exceptionReason(name: string): string | null {
  if (ACCEPTED_EXCEPTIONS[name]) return ACCEPTED_EXCEPTIONS[name]
  const hit = ACCEPTED_EXCEPTION_PREFIXES.find(e => name.startsWith(e.prefix))
  return hit ? hit.reason : null
}

const RANK: Record<LicenseCategory, number> = {
  permissive: 0,
  'weak-copyleft': 1,
  'strong-copyleft': 2,
  'non-osi': 3,
  missing: 4,
}

function classifyId(id: string): LicenseCategory {
  const clean = id.replace(/\+$/, '').trim()
  if (PERMISSIVE.has(clean)) return 'permissive'
  if (WEAK_COPYLEFT.test(clean)) return 'weak-copyleft'
  if (STRONG_COPYLEFT.test(clean)) return 'strong-copyleft'
  return 'non-osi'
}

function worst(a: LicenseCategory, b: LicenseCategory): LicenseCategory {
  return RANK[a] >= RANK[b] ? a : b
}

function best(a: LicenseCategory, b: LicenseCategory): LicenseCategory {
  return RANK[a] <= RANK[b] ? a : b
}

/**
 * Classify an SPDX-ish license expression. `OR` takes the most permissive
 * alternative (the licensee chooses), `AND` the most restrictive. Non-SPDX
 * strings such as "SEE LICENSE IN README.md" or "UNLICENSED" are `non-osi`.
 */
export function classifyLicense(
  expr: string | null | undefined
): LicenseCategory {
  if (!expr || !expr.trim()) return 'missing'
  const text = expr.trim()
  if (/^SEE LICEN[CS]E/i.test(text) || /^UNLICENSED$/i.test(text))
    return 'non-osi'

  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? []
  let pos = 0
  const parseOr = (): LicenseCategory => {
    let acc = parseAnd()
    while (tokens[pos]?.toUpperCase() === 'OR') {
      pos++
      acc = best(acc, parseAnd())
    }
    return acc
  }
  const parseAnd = (): LicenseCategory => {
    let acc = parseAtom()
    while (tokens[pos]?.toUpperCase() === 'AND') {
      pos++
      acc = worst(acc, parseAtom())
    }
    return acc
  }
  const parseAtom = (): LicenseCategory => {
    const tok = tokens[pos++]
    if (tok === undefined) return 'missing'
    if (tok === '(') {
      const inner = parseOr()
      if (tokens[pos] === ')') pos++
      return inner
    }
    // `X WITH exception` — the exception only widens rights; classify X.
    if (tokens[pos]?.toUpperCase() === 'WITH') pos += 2
    return classifyId(tok)
  }
  return parseOr()
}

/** Normalise the lockfile/package.json license field to one string. */
export function licenseOf(
  entry: Pick<LockEntry, 'license' | 'licenses'>
): string | null {
  if (typeof entry.license === 'string' && entry.license.trim())
    return entry.license.trim()
  if (typeof entry.licenses === 'string' && entry.licenses.trim())
    return entry.licenses.trim()
  if (Array.isArray(entry.licenses)) {
    const ids = entry.licenses.map(l => l?.type).filter((t): t is string => !!t)
    if (ids.length) return ids.length === 1 ? ids[0]! : `(${ids.join(' OR ')})`
  }
  return null
}

/**
 * Identify a license from the text of a LICENSE file. Used only when neither
 * the lockfile nor package.json declares one; recognises the common headers.
 */
export function sniffLicenseText(text: string): string | null {
  const head = text.slice(0, 600)
  if (/Apache License[\s\S]*Version 2\.0/i.test(head)) return 'Apache-2.0'
  if (
    /\bMIT License\b/i.test(head) ||
    /Permission is hereby granted, free of charge/i.test(text)
  )
    return 'MIT'
  if (/\bISC License\b/i.test(head)) return 'ISC'
  return null
}

/** Node-style resolution of `dep` as required from the package at `fromPath`. */
export function resolveDependency(
  packages: Lockfile['packages'],
  fromPath: string,
  dep: string
): string | null {
  let base = fromPath
  for (;;) {
    const candidate = base
      ? `${base}/node_modules/${dep}`
      : `node_modules/${dep}`
    if (packages[candidate]) return candidate
    if (!base) return null
    const idx = base.lastIndexOf('/node_modules/')
    if (idx >= 0) base = base.slice(0, idx)
    else if (base.startsWith('node_modules/')) base = ''
    else base = '' // workspace dir (e.g. `cli`) → fall back to the root node_modules
  }
}

function nameFromPath(path: string): string {
  const idx = path.lastIndexOf('node_modules/')
  return idx >= 0 ? path.slice(idx + 'node_modules/'.length) : path
}

export type Closure = { packages: ProdPackage[]; unresolved: string[] }

/** Collect the production closure (deduped by lockfile path). */
export function collectProdPackages(lock: Lockfile): Closure {
  const pkgs = lock.packages
  const roots = Object.keys(pkgs).filter(
    k =>
      (k === '' ||
        (!k.startsWith('node_modules/') && !k.includes('/node_modules/'))) &&
      // A workspace listed in the lockfile whose directory is gone is marked extraneous.
      !pkgs[k]!.extraneous
  )
  const workspaceRoots = new Set(roots)
  // path → { optionalOnly, via }
  const seen = new Map<string, { optionalOnly: boolean; via: string }>()
  const unresolved: string[] = []
  const queue: Array<{ path: string; optionalOnly: boolean }> = roots.map(
    r => ({
      path: r,
      optionalOnly: false,
    })
  )

  while (queue.length) {
    const { path, optionalOnly } = queue.shift()!
    let entry = pkgs[path]
    let realPath = path
    if (entry?.link && entry.resolved) {
      realPath = entry.resolved
      entry = pkgs[realPath]
    }
    if (!entry) continue
    const edges: Array<{ name: string; optional: boolean }> = [
      ...Object.keys(entry.dependencies ?? {}).map(name => ({
        name,
        optional: false,
      })),
      ...Object.keys(entry.optionalDependencies ?? {}).map(name => ({
        name,
        optional: true,
      })),
      ...Object.keys(entry.peerDependencies ?? {})
        .filter(name => !entry!.peerDependenciesMeta?.[name]?.optional)
        .map(name => ({ name, optional: false })),
    ]
    const via =
      realPath === '' ? '<root>' : (entry.name ?? nameFromPath(realPath))
    for (const edge of edges) {
      const target = resolveDependency(pkgs, realPath, edge.name)
      const childOptional = optionalOnly || edge.optional
      if (!target) {
        if (!childOptional) unresolved.push(`${edge.name} (required by ${via})`)
        continue
      }
      if (workspaceRoots.has(target)) continue
      const prev = seen.get(target)
      if (prev && (prev.optionalOnly === false || childOptional)) continue
      seen.set(target, { optionalOnly: childOptional, via: prev?.via ?? via })
      queue.push({ path: target, optionalOnly: childOptional })
    }
  }

  const packages: ProdPackage[] = []
  for (const [path, meta] of seen) {
    const entry = pkgs[path]!
    if (entry.link) continue // workspace symlink; the workspace itself is a root
    const platform =
      entry.os || entry.cpu
        ? [entry.os?.join('|'), entry.cpu?.join('|')].filter(Boolean).join('/')
        : null
    packages.push({
      name: entry.name ?? nameFromPath(path),
      version: entry.version ?? '?',
      path,
      license: licenseOf(entry),
      licenseSource: licenseOf(entry) ? 'lockfile' : null,
      optionalOnly: meta.optionalOnly,
      platform,
      via: meta.via,
    })
  }
  packages.sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  )
  return { packages, unresolved: [...new Set(unresolved)].sort() }
}

export type Drift = { path: string; issue: string }

/** Compare the lockfile view with what is actually installed in node_modules. */
export function checkInstalled(
  packages: ProdPackage[],
  readPackageJson: (path: string) => LockEntry | null
): { drift: Drift[]; notInstalled: number } {
  const drift: Drift[] = []
  let notInstalled = 0
  for (const p of packages) {
    const installed = readPackageJson(p.path)
    if (!installed) {
      notInstalled++
      continue
    }
    if (installed.version?.replace(/^v/, '') !== p.version.replace(/^v/, '')) {
      drift.push({
        path: p.path,
        issue: `version lock=${p.version} installed=${installed.version}`,
      })
    }
    const lic = licenseOf(installed)
    if (p.licenseSource !== 'LICENSE file' && lic !== p.license) {
      drift.push({
        path: p.path,
        issue: `license lock=${p.license} installed=${lic}`,
      })
    }
  }
  return { drift, notInstalled }
}

/** A dual license like `MPL-2.0 OR Apache-2.0`: permissive, but worth listing. */
export function hasCopyleftAlternative(license: string | null): boolean {
  if (!license || !/\bOR\b/i.test(license)) return false
  return /\b(MPL|LGPL|GPL|AGPL|EPL)-/.test(license)
}

export type Finding = ProdPackage & {
  category: LicenseCategory
  accepted: string | null
}

export function findings(packages: ProdPackage[]): Finding[] {
  const unique = new Map<string, ProdPackage>()
  for (const p of packages)
    if (!unique.has(`${p.name}@${p.version}`))
      unique.set(`${p.name}@${p.version}`, p)
  return [...unique.values()]
    .map(p => {
      const category = classifyLicense(p.license)
      return {
        ...p,
        category,
        accepted: category === 'permissive' ? null : exceptionReason(p.name),
      }
    })
    .filter(
      f => f.category !== 'permissive' || hasCopyleftAlternative(f.license)
    )
}

export function groupByLicense(
  packages: ProdPackage[]
): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const p of packages)
    counts.set(
      p.license ?? '(missing)',
      (counts.get(p.license ?? '(missing)') ?? 0) + 1
    )
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function renderMarkdown(
  closure: Closure,
  extra?: { drift: Drift[]; notInstalled: number }
): string {
  const { packages, unresolved } = closure
  const fs = findings(packages)
  const lines: string[] = []
  lines.push(`Production packages (unique lockfile paths): ${packages.length}`)
  lines.push(
    `Unique name@version: ${new Set(packages.map(p => `${p.name}@${p.version}`)).size}`
  )
  lines.push('')
  lines.push('| License | Count |', '| --- | --- |')
  for (const [lic, n] of groupByLicense(packages))
    lines.push(`| ${lic} | ${n} |`)
  lines.push('')
  lines.push(
    '| Package | Version | License | Category | Pulled in by | Status |',
    '| --- | --- | --- | --- | --- | --- |'
  )
  for (const f of fs) {
    const status =
      f.category === 'permissive'
        ? 'OK (permissive alternative chosen)'
        : f.accepted
          ? `accepted: ${f.accepted}`
          : '**BLOCKER**'
    const where = f.platform
      ? `${f.via} (optional, ${f.platform})`
      : f.optionalOnly
        ? `${f.via} (optional)`
        : f.via
    const lic =
      f.licenseSource === 'LICENSE file'
        ? `${f.license} (LICENSE file only)`
        : (f.license ?? '(missing)')
    lines.push(
      `| ${f.name} | ${f.version} | ${lic} | ${f.category} | ${where} | ${status} |`
    )
  }
  const sniffed = packages.filter(p => p.licenseSource === 'LICENSE file')
  if (sniffed.length) {
    lines.push(
      '',
      'No license field in package.json; identified from the LICENSE file:'
    )
    for (const p of sniffed)
      lines.push(`- ${p.name}@${p.version}: ${p.license}`)
  }
  if (unresolved.length) {
    lines.push(
      '',
      'Unresolved required dependencies:',
      ...unresolved.map(u => `- ${u}`)
    )
  }
  if (extra) {
    lines.push(
      '',
      `node_modules cross-check: ${extra.notInstalled} not installed locally (other-platform optionals), ${extra.drift.length} drift`
    )
    for (const d of extra.drift) lines.push(`- ${d.path}: ${d.issue}`)
  }
  return lines.join('\n') + '\n'
}

export function hasBlockers(closure: Closure): boolean {
  return (
    closure.unresolved.length > 0 ||
    findings(closure.packages).some(
      f => f.category !== 'permissive' && !f.accepted
    )
  )
}

const LICENSE_FILE_NAMES = [
  'LICENSE',
  'license',
  'LICENSE.md',
  'LICENSE.txt',
  'license.md',
]

/**
 * Fill licenses the lockfile omitted: first the installed package.json, then
 * a LICENSE file sniff. Mutates and returns `packages`.
 */
export function fillMissingLicenses(
  packages: ProdPackage[],
  readPackageJson: (path: string) => LockEntry | null,
  readLicenseFile: (path: string) => string | null
): ProdPackage[] {
  for (const p of packages) {
    if (p.license) continue
    const fromPkg = readPackageJson(p.path)
    const declared = fromPkg ? licenseOf(fromPkg) : null
    if (declared) {
      p.license = declared
      p.licenseSource = 'package.json'
      continue
    }
    const text = readLicenseFile(p.path)
    const sniffed = text ? sniffLicenseText(text) : null
    if (sniffed) {
      p.license = sniffed
      p.licenseSource = 'LICENSE file'
    }
  }
  return packages
}

function run(argv: string[], root: string): number {
  const lock = JSON.parse(
    readFileSync(join(root, 'package-lock.json'), 'utf8')
  ) as Lockfile
  const closure = collectProdPackages(lock)
  // Fill licenses the lockfile omitted from the installed package.json.
  const readPkg = (path: string): LockEntry | null => {
    const file = join(root, path, 'package.json')
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as LockEntry)
      : null
  }
  fillMissingLicenses(closure.packages, readPkg, path => {
    const file = LICENSE_FILE_NAMES.map(f => join(root, path, f)).find(f =>
      existsSync(f)
    )
    return file ? readFileSync(file, 'utf8') : null
  })

  if (argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        { ...closure, findings: findings(closure.packages) },
        null,
        2
      ) + '\n'
    )
  } else {
    const extra = argv.includes('--check-node-modules')
      ? checkInstalled(closure.packages, readPkg)
      : undefined
    process.stdout.write(renderMarkdown(closure, extra))
  }
  return hasBlockers(closure) ? 1 : 0
}

if (process.argv[1] && process.argv[1].endsWith('license-audit.ts')) {
  process.exit(run(process.argv.slice(2), process.cwd()))
}
