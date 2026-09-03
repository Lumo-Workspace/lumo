/**
 * PURE — parses a unified diff into added lines WITH new-file line numbers.
 *
 * Sibling of `addedLinesFromDiff` in lib/integrations/github/contents.ts
 * (which LUM-590 still uses and which carries no line numbers). Kept separate
 * so the older caller is untouched.
 *
 * Rules:
 * - `+++ b/<path>` starts a file; `+++ /dev/null` (deleted file) is skipped.
 * - `@@ -a,b +c,d @@` resets the new-file cursor to `c`.
 * - `+` lines are collected at the cursor and advance it; context lines
 *   advance it; `-` lines and `\ No newline…` markers do not.
 * - Binary files never produce lines.
 */
import type { AddedFile } from './types'

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function addedLinesWithNumbers(diff: string): AddedFile[] {
  const files: AddedFile[] = []
  let current: AddedFile | null = null
  let cursor = 0
  let inHunk = false

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      inHunk = false
      if (raw === '+++ /dev/null') {
        current = null
        continue
      }
      const path = raw.startsWith('+++ b/') ? raw.slice(6) : raw.slice(4)
      current = { path, lines: [] }
      files.push(current)
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff --git ')) {
      inHunk = false
      continue
    }
    if (!current) continue

    const hunk = HUNK_HEADER.exec(raw)
    if (hunk) {
      cursor = Number(hunk[1])
      inHunk = true
      continue
    }
    if (!inHunk) continue

    if (raw.startsWith('+')) {
      current.lines.push({ lineNo: cursor, text: raw.slice(1) })
      cursor++
      continue
    }
    if (raw.startsWith('-') || raw.startsWith('\\')) continue
    cursor++
  }

  return files.filter(f => f.lines.length > 0)
}
