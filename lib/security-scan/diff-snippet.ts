/**
 * LUM-740 — the unified-diff hunk around one new-file line, for the
 * suggested-disposition falsifier (spec §6 L5 item 2: "finding + diff
 * snippet"). Pure text; no I/O.
 */

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Default number of hunk lines kept on each side of the target line. */
export const DIFF_HUNK_RADIUS = 20

interface HunkLine {
  text: string
  /** New-file line number this row sits at (a `-` row takes its neighbour's). */
  newLine: number
}

/**
 * The hunk of `path` that contains new-file line `line`: its `@@` header
 * followed by the hunk rows within `radius` new-file lines of the target.
 * `null` when the file is not in the diff or no hunk covers the line.
 */
export function extractDiffHunk(
  diff: string,
  path: string,
  line: number,
  radius = DIFF_HUNK_RADIUS
): string | null {
  let inFile = false
  let header: string | null = null
  let rows: HunkLine[] = []
  let newLine = 0
  let found: { header: string; rows: HunkLine[] } | null = null

  const flush = () => {
    if (header && rows.some(r => r.newLine === line && !r.text.startsWith('-')))
      found = { header, rows }
  }

  for (const raw of diff.split('\n')) {
    if (found) break
    if (raw.startsWith('+++ ')) {
      flush()
      header = null
      rows = []
      inFile = raw === `+++ b/${path}` || raw === `+++ ${path}`
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git ')) {
      continue
    }
    if (!inFile) continue
    const m = HUNK_HEADER_RE.exec(raw)
    if (m) {
      flush()
      header = raw
      rows = []
      newLine = Number(m[1]) - 1
      continue
    }
    if (!header) continue
    if (raw.startsWith('-')) {
      rows.push({ text: raw, newLine: Math.max(newLine, 1) })
    } else if (raw.startsWith('\\')) {
      continue
    } else {
      newLine += 1
      rows.push({ text: raw, newLine })
    }
  }
  if (!found) flush()
  if (!found) return null
  const hit = found as { header: string; rows: HunkLine[] }
  const kept = hit.rows.filter(r => Math.abs(r.newLine - line) <= radius)
  return [hit.header, ...kept.map(r => r.text)].join('\n')
}
