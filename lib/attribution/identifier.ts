const IDENTIFIER_RE = /^([A-Za-z]{1,10})-(\d+)$/

export interface ParsedIdentifier {
  team: string
  number: number
}

/** `lum-012` → { team: 'LUM', number: 12 }; null when not a task identifier. */
export function parseTaskIdentifier(raw: string): ParsedIdentifier | null {
  const m = IDENTIFIER_RE.exec(raw)
  if (!m) return null
  return { team: m[1]!.toUpperCase(), number: Number(m[2]) }
}

/** Canonical `<TEAM>-<n>` form (`LUM-012` → `LUM-12`); null when unparseable. */
export function canonicalTaskIdentifier(raw: string): string | null {
  const p = parseTaskIdentifier(raw)
  return p ? `${p.team}-${p.number}` : null
}
