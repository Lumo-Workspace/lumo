/**
 * LUM-1151 — the walkthrough in Lumo's summary comment: what the PR changes,
 * file by file. PURE.
 *
 * Composable on purpose: `buildWalkthrough` takes named sections and folds
 * them into one `<details>` block, so a later section (e.g. a diagram of
 * the change) is one more entry, not a new block in the summary.
 *
 * File names come from GitHub's file list of the PR (author-controlled
 * text), so each is reduced to inert inline code before it reaches the
 * comment.
 */
import { sanitizeField } from '@/shared/src/sanitize'

/** One changed file, as GitHub's `pulls/{n}/files` lists it. */
export interface ChangedFile {
  filename: string
  /** added | removed | modified | renamed | copied | changed | unchanged */
  status: string
  additions: number
  deletions: number
  /** Set for a rename: the old path. */
  previousFilename?: string | null
}

/** Rows the table lists by name; the rest are counted. */
export const WALKTHROUGH_MAX_FILES = 50

/** A path as inline code: nothing that could close the span or open markup. */
function codePath(path: string): string {
  return `\`${sanitizeField(path)
    .replace(/[`<>|\r\n]/g, '')
    .slice(0, 200)}\``
}

const STATUS_LABEL: Record<string, string> = {
  added: 'added',
  removed: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  copied: 'copied',
  changed: 'changed',
  unchanged: 'unchanged',
}

function count(n: number): string {
  return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : '0'
}

/** PURE — the changed-files table (null when there is nothing to list). */
export function changedFilesTable(
  files: readonly ChangedFile[]
): string | null {
  if (files.length === 0) return null
  const rows = files.slice(0, WALKTHROUGH_MAX_FILES).map(f => {
    const status = STATUS_LABEL[f.status] ?? 'changed'
    const from =
      f.status === 'renamed' && f.previousFilename
        ? ` (from ${codePath(f.previousFilename)})`
        : ''
    return `| ${codePath(f.filename)}${from} | ${status} | +${count(f.additions)} / −${count(f.deletions)} |`
  })
  const rest = files.length - rows.length
  const added = files.reduce((n, f) => n + (f.additions || 0), 0)
  const deleted = files.reduce((n, f) => n + (f.deletions || 0), 0)
  const lines = ['| File | Change | Lines |', '| --- | --- | --- |', ...rows]
  const noun = files.length === 1 ? 'file' : 'files'
  const tail = [
    `${files.length} ${noun} changed, +${count(added)} / −${count(deleted)} lines${rest > 0 ? ` — ${rest} more not listed` : ''}.`,
  ]
  return [...lines, '', ...tail].join('\n')
}

/** One section of the walkthrough: a bold title and its markdown. */
export interface WalkthroughSection {
  title: string
  body: string
}

/** PURE — the changed-files section, or null when there are no files. */
export function changedFilesSection(
  files: readonly ChangedFile[] | null | undefined
): WalkthroughSection | null {
  const table = changedFilesTable(files ?? [])
  return table ? { title: 'Changed files', body: table } : null
}

/**
 * PURE — the walkthrough block (folded), or null when no section has
 * anything to say.
 */
export function buildWalkthrough(
  sections: ReadonlyArray<WalkthroughSection | null | undefined>
): string | null {
  const present = sections.filter((s): s is WalkthroughSection => !!s)
  if (present.length === 0) return null
  const body = present.map(s => `**${s.title}**\n\n${s.body}`).join('\n\n')
  return `<details>\n<summary>Walkthrough</summary>\n\n${body}\n\n</details>`
}
