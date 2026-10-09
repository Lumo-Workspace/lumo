/**
 * LUM-1051 — Codex writes files with one tool, `apply_patch`, whose
 * `tool_input.command` is the whole patch text:
 *
 *   *** Begin Patch
 *   *** Update File: /repo/a.txt
 *   *** Move to: /repo/b.txt        (optional, Update only)
 *   @@
 *   -old
 *   +new
 *   *** Add File: /repo/c.txt
 *   +line
 *   *** Delete File: /repo/d.test.ts
 *   *** End Patch
 *
 * Shared by the CLI hook (gitignore / deleted-test probes) and the server
 * (file path, write-tool checks, secret scan) so both read a patch the same way.
 */

export const APPLY_PATCH_TOOL = 'apply_patch'

export type ApplyPatchOp = 'add' | 'update' | 'delete'

export interface ApplyPatchFile {
  op: ApplyPatchOp
  path: string
  /** Rename target of an `Update File` (`*** Move to:`), if any. */
  moveTo?: string
}

export interface ParsedApplyPatch {
  files: ApplyPatchFile[]
  /** The `+` lines of every hunk, joined — the content the patch writes. */
  addedText: string
  /** Count of `+` / `-` hunk lines. */
  added: number
  removed: number
}

const HEADER_RE = /^\*\*\* (Add|Update|Delete) File: (.+)$/
const MOVE_RE = /^\*\*\* Move to: (.+)$/

/** Parse patch text; files in patch order. Never throws. */
export function parseApplyPatch(text: string): ParsedApplyPatch {
  const files: ApplyPatchFile[] = []
  const added: string[] = []
  let removed = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const header = HEADER_RE.exec(line)
    if (header) {
      const op = header[1]!.toLowerCase() as ApplyPatchOp
      files.push({ op, path: header[2]!.trim() })
      continue
    }
    const move = MOVE_RE.exec(line)
    if (move) {
      const last = files[files.length - 1]
      if (last && last.op === 'update') last.moveTo = move[1]!.trim()
      continue
    }
    if (line.startsWith('***')) continue
    if (files.length === 0) continue
    if (line.startsWith('+')) added.push(line.slice(1))
    else if (line.startsWith('-')) removed++
  }
  return {
    files,
    addedText: added.join('\n'),
    added: added.length,
    removed,
  }
}

/** The patch text of an apply_patch tool_input, or null. */
export function applyPatchText(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null
  const cmd = (toolInput as Record<string, unknown>).command
  return typeof cmd === 'string' ? cmd : null
}

/**
 * The first file an apply_patch writes (add / update, the rename target when
 * moved), falling back to the first deleted file. Null for no header.
 */
export function applyPatchPrimaryPath(toolInput: unknown): string | null {
  const text = applyPatchText(toolInput)
  if (text === null) return null
  const { files } = parseApplyPatch(text)
  const written = files.find(f => f.op !== 'delete')
  if (written) return written.moveTo ?? written.path
  return files[0]?.path ?? null
}

/** Files an apply_patch deletes (`*** Delete File:`). */
export function applyPatchDeletedPaths(toolInput: unknown): string[] {
  const text = applyPatchText(toolInput)
  if (text === null) return []
  return parseApplyPatch(text)
    .files.filter(f => f.op === 'delete')
    .map(f => f.path)
}
