/**
 * `osv-scanner.toml`'s `[[IgnoredVulns]]` list, read without a TOML library:
 * `lumo security scan --deps` fast mode honours the same ignores osv-scanner
 * applies on the managed PR scan. Only what an ignore needs is parsed — each
 * entry's `id` and `ignoreUntil`; other tables and keys (`reason`, multi-line
 * strings, `[[PackageOverrides]]`) are skipped. PURE.
 */

export interface OsvIgnore {
  id: string
  /** End of the ignore; null = no expiry. */
  ignoreUntil: Date | null
  /** The raw `ignoreUntil` text, for messages (`2027-01-05`). */
  until: string | null
}

/** The value of `key = value` when it is a one-line string or a bare date. */
function scalarValue(raw: string): string | null {
  const v = raw.trim()
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(v)
  if (basic) {
    try {
      return JSON.parse(`"${basic[1]}"`) as string
    } catch {
      return basic[1] ?? null
    }
  }
  const literal = /^'([^']*)'/.exec(v)
  if (literal) return literal[1] ?? null
  // Bare TOML date / datetime (`2027-01-05`, `2027-01-05T00:00:00Z`).
  const bare = /^([0-9][0-9T:.+\-Z ]*[0-9Z])/.exec(v)
  return bare ? (bare[1] ?? '').trim() : null
}

/** A TOML date or datetime → Date (a bare date is midnight UTC); null when unreadable. */
export function parseTomlDate(text: string): Date | null {
  const t = text.trim().replace(' ', 'T')
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00Z` : t)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Every `[[IgnoredVulns]]` entry with an `id`. Multi-line strings (`"""` /
 * `'''`) are skipped wholesale so a `reason` that mentions `id = …` cannot
 * add an ignore.
 */
export function parseOsvIgnores(toml: string): OsvIgnore[] {
  const out: OsvIgnore[] = []
  let current: { id?: string; until?: string } | null = null
  let inMultiline: '"""' | "'''" | null = null
  const flush = () => {
    if (current?.id) {
      const until = current.until ?? null
      out.push({
        id: current.id,
        until,
        // An unreadable date never means "forever": it counts as lapsed.
        ignoreUntil:
          until === null ? null : (parseTomlDate(until) ?? new Date(0)),
      })
    }
    current = null
  }

  for (const rawLine of toml.split(/\r?\n/)) {
    if (inMultiline) {
      if (rawLine.includes(inMultiline)) inMultiline = null
      continue
    }
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?/.exec(line)
    if (header) {
      flush()
      if (line.startsWith('[[') && header[1] === 'IgnoredVulns') current = {}
      continue
    }
    const kv = /^([A-Za-z0-9_\-]+)\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1] ?? ''
    const rest = kv[2] ?? ''
    const opener = rest.trimStart().slice(0, 3)
    if (opener === '"""' || opener === "'''") {
      // Opens a multi-line string; it closes on this line only if the
      // delimiter appears again after the opener.
      if (!rest.trimStart().slice(3).includes(opener)) inMultiline = opener
      continue
    }
    if (!current) continue
    const value = scalarValue(rest)
    if (value === null) continue
    if (key === 'id') current.id = value
    else if (key === 'ignoreUntil') current.until = value
  }
  flush()
  return out
}

/**
 * The ignore that covers an advisory (its id or any alias — osv-scanner
 * matches aliases too) and is still in force at `now`; null when none.
 * `expired` is the newest lapsed ignore that would have covered it, so the
 * report can say why a once-ignored advisory is back.
 */
export function matchIgnore(
  ignores: OsvIgnore[],
  ids: string[],
  now: Date
): { active: OsvIgnore | null; expired: OsvIgnore | null } {
  const keys = new Set(ids.map(id => id.toUpperCase()))
  let active: OsvIgnore | null = null
  let expired: OsvIgnore | null = null
  for (const ig of ignores) {
    if (!keys.has(ig.id.toUpperCase())) continue
    if (ig.ignoreUntil === null || ig.ignoreUntil.getTime() > now.getTime()) {
      active = ig
    } else if (
      !expired ||
      (expired.ignoreUntil?.getTime() ?? 0) < ig.ignoreUntil.getTime()
    ) {
      expired = ig
    }
  }
  return { active, expired: active ? null : expired }
}
