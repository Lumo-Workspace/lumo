/**
 * LUM-1147 — path instructions and the tone instruction: review guidance
 * the repository's owners write (in Lumo's repository settings or
 * `.lumo.yaml`), added to the AI review's prompt. PURE; the service passes
 * the injection guard in.
 *
 * Workspace-authored prompt text, so:
 *  - it only ever reaches the AI review's prompt, fenced as data and run
 *    line by line through the guard chain. Nothing reads it as a control:
 *    it cannot turn a layer off, mark a finding, approve, or change what
 *    blocks DONE — the deterministic layers never see it;
 *  - it is bounded: entries, characters per entry, and characters rendered
 *    per review (`REVIEW_PATH_INSTRUCTIONS_MAX_CHARS`, the same size as the
 *    learnings block), and it is paid for out of the review context budget;
 *  - only instructions whose glob matches a file the review reads are sent.
 */
import { globToRegExp } from '@/ee/security/security-scan/reviewable-path'

/** Path instructions per repository. */
export const PATH_INSTRUCTIONS_MAX_ENTRIES = 20
/** Characters in one entry's glob. */
export const PATH_INSTRUCTION_PATH_MAX_CHARS = 200
/** Characters in one entry's instructions. */
export const PATH_INSTRUCTION_MAX_CHARS = 1_000
/** Characters of instructions one review prompt carries (≈ 1k tokens). */
export const REVIEW_PATH_INSTRUCTIONS_MAX_CHARS = 4_000
/** Characters in the tone instruction. */
export const TONE_INSTRUCTIONS_MAX_CHARS = 250

export interface PathInstruction {
  /** A glob over repository paths (same syntax as the path filters). */
  path: string
  instructions: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Whitespace (line breaks included) collapsed to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * PURE — a stored / submitted list as clean entries: trimmed, blanks and
 * malformed entries dropped, bounded, the first entry for a glob kept.
 */
export function normalizePathInstructions(raw: unknown): PathInstruction[] {
  if (!Array.isArray(raw)) return []
  const out: PathInstruction[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!isRecord(item)) continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    const instructions =
      typeof item.instructions === 'string' ? item.instructions.trim() : ''
    if (!path || !instructions || /[\r\n]/.test(path)) continue
    if (path.length > PATH_INSTRUCTION_PATH_MAX_CHARS) continue
    if (seen.has(path)) continue
    seen.add(path)
    out.push({
      path,
      instructions: instructions.slice(0, PATH_INSTRUCTION_MAX_CHARS),
    })
    if (out.length >= PATH_INSTRUCTIONS_MAX_ENTRIES) break
  }
  return out
}

/** PURE — a tone value as stored: one line, bounded; blank = null. */
export function normalizeToneInstructions(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = oneLine(raw).slice(0, TONE_INSTRUCTIONS_MAX_CHARS)
  return t.length > 0 ? t : null
}

/** PURE — the entries whose glob matches at least one reviewed file. */
export function matchingPathInstructions(
  list: readonly PathInstruction[],
  reviewedPaths: readonly string[]
): PathInstruction[] {
  return list.filter(entry => {
    let re: RegExp
    try {
      re = globToRegExp(entry.path)
    } catch {
      return false
    }
    return reviewedPaths.some(p => re.test(p))
  })
}

/** LUM-1147 — the prompt block and the entries it actually carries. */
export interface RenderedPathInstructions {
  /** One guarded line per entry; `''` when nothing matches. */
  text: string
  /** The entries rendered into `text` (after the size cap), in order. */
  sent: PathInstruction[]
}

/**
 * PURE — the prompt block: one line per matching entry, `- [glob] text`,
 * each through `guard` (the caller passes `guardPromptLineText`), capped at
 * `REVIEW_PATH_INSTRUCTIONS_MAX_CHARS` on whole lines, in the listed order —
 * with the entries that made it in, so a finding's claim to apply one can
 * be checked against what the model was really given.
 */
export function planPathInstructions(
  list: readonly PathInstruction[],
  reviewedPaths: readonly string[],
  guard: (line: string) => string
): RenderedPathInstructions {
  const lines: string[] = []
  const sent: PathInstruction[] = []
  let used = 0
  for (const entry of matchingPathInstructions(list, reviewedPaths)) {
    const text = oneLine(entry.instructions)
    if (!text) continue
    // The glob is workspace-authored too: guarded like the text.
    const line = `- [${guard(oneLine(entry.path))}] ${guard(text)}`
    if (used + line.length + 1 > REVIEW_PATH_INSTRUCTIONS_MAX_CHARS) break
    lines.push(line)
    sent.push(entry)
    used += line.length + 1
  }
  return { text: lines.join('\n'), sent }
}

/** PURE — `planPathInstructions`' prompt block alone. */
export function renderPathInstructions(
  list: readonly PathInstruction[],
  reviewedPaths: readonly string[],
  guard: (line: string) => string
): string {
  return planPathInstructions(list, reviewedPaths, guard).text
}

/**
 * PURE — a finding's claim to apply a path instruction, checked: the glob
 * the model named (as written in the prompt, brackets optional) must be one
 * of the instructions SENT in this review (`sent`, compared as rendered:
 * one line, through `guard`), and that glob must match the finding's own
 * file. Returns the stored glob, or null — an unmatched claim is dropped,
 * never trusted.
 */
export function verifyPathInstructionClaim(
  claim: unknown,
  filePath: string,
  sent: readonly PathInstruction[],
  guard: (line: string) => string
): string | null {
  if (typeof claim !== 'string') return null
  const named = oneLine(claim)
    .replace(/^\[(.*)\]$/, '$1')
    .trim()
  if (!named) return null
  for (const entry of sent) {
    const rendered = guard(oneLine(entry.path))
    if (named !== rendered && named !== entry.path) continue
    let re: RegExp
    try {
      re = globToRegExp(entry.path)
    } catch {
      return null
    }
    return re.test(filePath) ? entry.path : null
  }
  return null
}

/** PURE — the tone line for the prompt (guarded, bounded); `''` = none. */
export function renderToneInstructions(
  tone: string | null | undefined,
  guard: (line: string) => string
): string {
  const t = normalizeToneInstructions(tone)
  return t ? guard(t) : ''
}
