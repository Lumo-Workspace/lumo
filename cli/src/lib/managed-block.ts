export const BLOCK_START =
  '<!-- lumo:team-memory:start (managed by `lumo memory sync` — do not edit inside) -->'
export const BLOCK_END = '<!-- lumo:team-memory:end -->'

/** Where the full team index lives, relative to the memory dir (LUM-1288). */
export const TEAM_INDEX_REL = 'team/INDEX.md'

/**
 * Byte budget for the index lines kept inside MEMORY.md (LUM-1288). Claude
 * Code loads only the first ~24KB of MEMORY.md, so a block with one line per
 * team memory (300+ lines ≈ 48KB) pushed most of the team corpus — and anything
 * after it — out of view. The block now carries a pointer to the full index
 * plus the leading entries (the bundle arrives best-first) up to this budget.
 */
export const BLOCK_TOP_BUDGET_BYTES = 2048

const bytes = (s: string) => Buffer.byteLength(s, 'utf8')

/**
 * The lines that go inside the managed block: a pointer to the full index, the
 * leading `lines` that fit `budget` bytes, and a count of the rest. `lines`
 * must already be in priority order. Empty in → empty out.
 */
export function blockLines(
  lines: string[],
  budget: number = BLOCK_TOP_BUDGET_BYTES
): string[] {
  if (lines.length === 0) return []
  const top: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = bytes(line) + 1
    if (used + cost > budget) break
    top.push(line)
    used += cost
  }
  const link = `[${TEAM_INDEX_REL}](${TEAM_INDEX_REL})`
  const out = [
    `Team memory: ${lines.length} entries, full index in ${link} — read it when a task touches team conventions, traps or decisions. Top entries:`,
    ...top,
  ]
  const rest = lines.length - top.length
  if (rest > 0) out.push(`- …and ${rest} more in ${link}`)
  return out
}

/** The full team index file: every line, in bundle order. */
export function teamIndexFile(lines: string[]): string {
  return [
    '# Team memory index',
    '',
    'Managed by `lumo memory sync` — regenerated on every sync, do not edit. Paths are relative to the memory directory.',
    '',
    ...lines,
    '',
  ].join('\n')
}

/**
 * Replace the managed team-memory block in MEMORY.md with `lines`, leaving
 * every byte OUTSIDE the markers untouched. If no block exists, append a fresh
 * one at EOF (original content preserved verbatim as the prefix). This is the
 * only writer allowed to touch MEMORY.md, and it never edits dev-authored
 * index lines outside the markers.
 */
export function upsertBlock(md: string, lines: string[]): string {
  const block = `${BLOCK_START}\n${lines.join('\n')}\n${BLOCK_END}`
  const s = md.indexOf(BLOCK_START)
  const e = md.indexOf(BLOCK_END)
  if (s !== -1 && e !== -1 && e > s) {
    return md.slice(0, s) + block + md.slice(e + BLOCK_END.length)
  }
  const sep = md.length === 0 ? '' : md.endsWith('\n') ? '\n' : '\n\n'
  return `${md}${sep}${block}\n`
}

/** Remove the managed block entirely (used by `--clean`). Bytes outside the
 * markers are preserved. No-op if no block is present. */
export function removeBlock(md: string): string {
  const s = md.indexOf(BLOCK_START)
  const e = md.indexOf(BLOCK_END)
  if (s === -1 || e === -1 || e < s) return md
  return md.slice(0, s) + md.slice(e + BLOCK_END.length)
}
