/**
 * PURE — LUM-1150: the one-click fix an AI-review inline comment may carry.
 *
 * The model may propose replacement code for a small range of ADDED lines;
 * GitHub renders it as a ```suggestion block the author commits in one click.
 * GitHub replaces exactly the commented lines (`start_line`..`line`) with the
 * block's content, so a wrong range silently corrupts the author's file. Every
 * rule here therefore errs towards dropping the suggestion — the comment
 * itself always stays:
 *
 *   · the range is short, contains the finding's line, and every line in it
 *     is an ADDED line of this head's PR diff (so it sits in one hunk, on the
 *     RIGHT side, exactly where the comment is anchored);
 *   · the model's verbatim evidence line is one of the replaced lines, so the
 *     range is the code the finding is about;
 *   · the code changes something, carries no secret (and replaces no line the
 *     model only saw masked), and cannot break out of the fence or forge one
 *     of Lumo's HTML-comment markers.
 */
import { z } from 'zod'
import type { AddedFile } from '@/lib/diff/diff-lines'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'

/** Lines one suggestion may replace. Longer rewrites are not "local". */
export const CODE_SUGGESTION_MAX_LINES = 12
/** Characters of replacement code; past this it is not a minimal fix. */
export const CODE_SUGGESTION_MAX_CHARS = 2000

/**
 * What is stored on the finding row (`codeSuggestion`) and posted. A type
 * alias, not an interface, so it is assignable to a Prisma Json input.
 */
export type CodeSuggestion = {
  startLine: number
  endLine: number
  code: string
}

/** The model's raw proposal (`SecurityJudgeSchema` → `suggestion`). */
export interface RawCodeSuggestion {
  startLine: number
  endLine: number
  code: string
}

const StoredSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  code: z.string(),
})

export interface ValidateCodeSuggestionInput {
  suggestion: RawCodeSuggestion | null | undefined
  /** The finding's new-file line (the model's), null = not placeable. */
  line: number | null
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  filePath: string
  /** The model's evidence line, raw (before redaction). */
  evidence: string
  /** The PR diff's added lines on this head (`addedLinesWithNumbers`). */
  files: AddedFile[]
}

function unsafeCode(code: string): boolean {
  return (
    code.length > CODE_SUGGESTION_MAX_CHARS ||
    code.includes('\r') ||
    // Would close the fence early and turn the rest into comment markdown.
    code.includes('```') ||
    code.includes('~~~') ||
    // Lumo's state markers are HTML comments parsed from the raw body.
    code.includes('<!--') ||
    code.includes('-->') ||
    // A secret, or the masked shape of one the model was shown.
    redactForInjection(code).text !== code
  )
}

/**
 * The suggestion to store for one AI-review finding, or null to post the
 * comment without one. Never throws.
 */
export function validateCodeSuggestion(
  input: ValidateCodeSuggestionInput
): CodeSuggestion | null {
  const s = input.suggestion
  if (!s || input.line === null || input.severity === 'LOW') return null
  const { startLine, endLine } = s
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null
  if (startLine < 1 || endLine < startLine) return null
  if (endLine - startLine + 1 > CODE_SUGGESTION_MAX_LINES) return null
  if (input.line < startLine || input.line > endLine) return null

  const file = input.files.find(f => f.path === input.filePath)
  if (!file) return null
  const byLine = new Map(file.lines.map(l => [l.lineNo, l.text]))
  const original: string[] = []
  for (let n = startLine; n <= endLine; n++) {
    const text = byLine.get(n)
    if (text === undefined) return null
    original.push(text)
  }
  // The model saw these lines masked: its replacement would commit the mask.
  if (original.some(t => redactForInjection(t).text !== t)) return null
  const evidence = input.evidence.trim()
  if (evidence.length === 0 || !original.some(t => t.trim() === evidence))
    return null

  const code = s.code.replace(/\n+$/, '')
  if (unsafeCode(code)) return null
  if (code === original.join('\n')) return null
  return { startLine, endLine, code }
}

/** The stored column, read back; anything malformed reads as none. */
export function parseCodeSuggestion(raw: unknown): CodeSuggestion | null {
  const parsed = StoredSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data
  if (s.endLine < s.startLine) return null
  if (s.endLine - s.startLine + 1 > CODE_SUGGESTION_MAX_LINES) return null
  if (unsafeCode(s.code)) return null
  return s
}

/** The GitHub suggestion block for the comment body. */
export function suggestionBlock(s: CodeSuggestion): string {
  return s.code.length > 0
    ? `\`\`\`suggestion\n${s.code}\n\`\`\``
    : '```suggestion\n```'
}

/** Where a comment carrying `s` is anchored: exactly the replaced lines. */
export function suggestionAnchor(s: CodeSuggestion): {
  line: number
  start_line?: number
  start_side?: 'RIGHT'
} {
  return s.startLine < s.endLine
    ? { line: s.endLine, start_line: s.startLine, start_side: 'RIGHT' }
    : { line: s.endLine }
}
