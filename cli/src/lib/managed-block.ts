export const BLOCK_START =
  '<!-- lumo:team-memory:start (managed by `lumo memory sync` — do not edit inside) -->'
export const BLOCK_END = '<!-- lumo:team-memory:end -->'

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
