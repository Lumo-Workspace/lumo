/**
 * LUM-1316 — Codeup's comparison (GetCompare `diffs[]`) in the shapes the
 * scan reads: one unified diff in git's format (what a PR `.diff` is), and
 * a per-file list with line counts and hunks.
 *
 * PURE.
 */
import type { CodeupCompareDiff } from './client'

/** A file's change kind in the vocabulary the scan reads. */
export type ChangedFileStatus = 'added' | 'removed' | 'renamed' | 'modified'

export interface CodeupChangedFile {
  filename: string
  status: ChangedFileStatus
  additions: number
  deletions: number
  previous_filename?: string
  /** The file's hunks (from the first `@@`); absent for a binary file. */
  patch?: string
}

export function changedFileStatus(d: CodeupCompareDiff): ChangedFileStatus {
  if (d.newFile) return 'added'
  if (d.deletedFile) return 'removed'
  if (d.renamedFile) return 'renamed'
  return 'modified'
}

/** The hunks of a file diff: everything from its first `@@` line. */
export function hunksOf(diff: string): string {
  const lines = diff.split('\n')
  const first = lines.findIndex(l => l.startsWith('@@'))
  return first === -1 ? '' : lines.slice(first).join('\n')
}

function countLines(hunks: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of hunks.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

/** One file's section of a unified diff, git headers included. */
export function fileSection(d: CodeupCompareDiff): string {
  const status = changedFileStatus(d)
  const header = [
    `diff --git a/${d.oldPath} b/${d.newPath}`,
    `--- ${status === 'added' ? '/dev/null' : `a/${d.oldPath}`}`,
    `+++ ${status === 'removed' ? '/dev/null' : `b/${d.newPath}`}`,
  ]
  if (d.isBinary)
    return [...header.slice(0, 1), 'Binary files differ'].join('\n')
  const hunks = hunksOf(d.diff).replace(/\n+$/, '')
  return hunks ? [...header, hunks].join('\n') : header[0]!
}

/** The whole comparison as one unified diff (empty for no change). */
export function toUnifiedDiff(diffs: readonly CodeupCompareDiff[]): string {
  if (diffs.length === 0) return ''
  return `${diffs.map(fileSection).join('\n')}\n`
}

/** The comparison as a per-file list (name, status, line counts, hunks). */
export function toChangedFiles(
  diffs: readonly CodeupCompareDiff[]
): CodeupChangedFile[] {
  return diffs.map(d => {
    const status = changedFileStatus(d)
    const hunks = d.isBinary ? '' : hunksOf(d.diff)
    return {
      filename: d.newPath,
      status,
      ...countLines(hunks),
      ...(status === 'renamed' ? { previous_filename: d.oldPath } : {}),
      ...(d.isBinary ? {} : { patch: hunks }),
    }
  })
}
