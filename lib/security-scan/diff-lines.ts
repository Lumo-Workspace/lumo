/**
 * PURE — parses a unified diff into added lines WITH new-file line numbers.
 *
 * Sibling of `addedLinesFromDiff` in lib/integrations/github/contents.ts
 * (which LUM-590 still uses and which carries no line numbers). Kept separate
 * so the older caller is untouched.
 *
 * Rules:
 * - `+++ b/<path>` starts a file; `+++ /dev/null` (deleted file) is skipped.
 * - `@@ -a,b +c,d @@` resets the new-file cursor to `c` and opens a hunk that
 *   consumes exactly `b` old-side and `d` new-side lines (an omitted count
 *   means 1).
 * - `+` lines are collected at the cursor and advance it; context lines
 *   advance it; `-` lines and `\ No newline…` markers do not.
 * - Binary files never produce lines.
 * - Trailing `\r` (CRLF diffs) is stripped from every line.
 *
 * WHY THE HUNK COUNTS ARE TRACKED (LUM-732 review C2): matching `+++ `/`--- `
 * anywhere let *diff content* impersonate a file header — a removed line whose
 * own text starts with `-- ` (`--- old sql comment`) closed the hunk and every
 * later added line in it was dropped, so a secret below it scanned CLEAN; an
 * added line starting with `++ ` (`+++ b/__tests__/decoy.test.ts`) opened a
 * bogus test file and downgraded the next real secret to LOW. Inside a hunk
 * the first character is authoritative and nothing is read as a header until
 * the declared line budget is spent. A body line with an unrecognised prefix
 * (nothing a real hunk emits) ends the hunk and is re-read as a header, so a
 * diff whose counts under-state its body cannot swallow the next file.
 */
import type { AddedFile } from './types'

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function addedLinesWithNumbers(diff: string): AddedFile[] {
  const files: AddedFile[] = []
  let current: AddedFile | null = null
  let cursor = 0
  // Lines still owed to the open hunk; both zero means "between hunks".
  let oldLeft = 0
  let newLeft = 0

  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw

    if (oldLeft > 0 || newLeft > 0) {
      const head = line[0]
      if (head === '+') {
        if (current) current.lines.push({ lineNo: cursor, text: line.slice(1) })
        cursor++
        newLeft = Math.max(0, newLeft - 1)
        continue
      }
      if (head === '-') {
        oldLeft = Math.max(0, oldLeft - 1)
        continue
      }
      if (head === '\\') continue
      if (head === ' ' || line === '') {
        cursor++
        oldLeft = Math.max(0, oldLeft - 1)
        newLeft = Math.max(0, newLeft - 1)
        continue
      }
      // Not a shape any hunk body has: the hunk is over, re-read as a header.
      oldLeft = 0
      newLeft = 0
    }

    if (line.startsWith('+++ ')) {
      if (line === '+++ /dev/null') {
        current = null
        continue
      }
      const path = line.startsWith('+++ b/') ? line.slice(6) : line.slice(4)
      current = { path, lines: [] }
      files.push(current)
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('diff --git ')) continue

    const hunk = HUNK_HEADER.exec(line)
    if (hunk) {
      cursor = Number(hunk[2])
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3])
    }
  }

  return files.filter(f => f.lines.length > 0)
}
