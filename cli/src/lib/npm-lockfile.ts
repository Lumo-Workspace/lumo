/**
 * npm `package-lock.json` / `npm-shrinkwrap.json` → the installed
 * `name@version` set, and the packages a change adds or moves to a new
 * version — what `lumo security scan --deps` fast mode sends to OSV. PURE.
 */

export interface NpmPackage {
  name: string
  version: string
}

/** Lockfile basenames fast mode reads. */
export const NPM_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json']

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** `node_modules/a/node_modules/@s/b` → `@s/b`; null for a non-dependency key (root, workspace). */
function nameFromKey(key: string): string | null {
  const i = key.lastIndexOf('node_modules/')
  if (i < 0) return null
  return key.slice(i + 'node_modules/'.length) || null
}

/** v1 lockfiles: `dependencies` nested by name. */
function walkV1(deps: unknown, out: Map<string, NpmPackage>): void {
  for (const [name, raw] of Object.entries(rec(deps) ?? {})) {
    const d = rec(raw)
    const version = str(d?.['version'])
    if (version && !d?.['bundled']) {
      out.set(`${name}@${version}`, { name, version })
    }
    walkV1(d?.['dependencies'], out)
  }
}

/**
 * Every installed package in the lockfile, keyed `name@version`. Throws on
 * text that is not JSON. The root and link entries are left out; workspace
 * entries stay, as osv-scanner keeps them.
 */
export function parseNpmLockfile(text: string): Map<string, NpmPackage> {
  const doc = rec(JSON.parse(text) as unknown)
  const out = new Map<string, NpmPackage>()
  if (!doc) return out
  const packages = rec(doc['packages'])
  if (packages) {
    for (const [key, raw] of Object.entries(packages)) {
      const p = rec(raw)
      // `""` is the project itself; a link points at a workspace entry listed on its own.
      if (key === '' || !p || p['link'] === true) continue
      const name = str(p['name']) ?? nameFromKey(key)
      const version = str(p['version'])
      if (!name || !version) continue
      out.set(`${name}@${version}`, { name, version })
    }
    return out
  }
  walkV1(doc['dependencies'], out)
  return out
}

/**
 * Packages at `head` that `base` did not have at that version: new packages
 * and version changes. Removals are not a risk and are not reported. A
 * missing or unparseable base counts as empty (the lockfile is new).
 */
export function lockfileDelta(base: string | null, head: string): NpmPackage[] {
  let before = new Map<string, NpmPackage>()
  if (base !== null) {
    try {
      before = parseNpmLockfile(base)
    } catch {
      before = new Map()
    }
  }
  const after = parseNpmLockfile(head)
  return [...after.entries()]
    .filter(([key]) => !before.has(key))
    .map(([, p]) => p)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    )
}
