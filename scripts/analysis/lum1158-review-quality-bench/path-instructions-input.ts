/**
 * LUM-1199 — per-PR path instructions for the review replay
 * (`../lum988-code-review-replay/replay.ts --instructions <file>`), through
 * the SAME pieces production uses: the stored-list normalisation
 * (`normalizePathInstructions`), then `planPathInstructions` over the files
 * the review covers with `guardPromptLineText` — never a bench-only
 * formatter. The file is `{ [prUrl]: PathInstruction[] }` (written by
 * `guidelines.ts` into the scratch dir; third-party text, never committed).
 */
import {
  normalizePathInstructions,
  planPathInstructions,
  verifyPathInstructionClaim,
  type PathInstruction,
  type RenderedPathInstructions,
} from '@/ee/security/security-scan/path-instructions'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'

/** PURE — the instructions file's text, refused unless it is a JSON object. */
export function parseInstructionsFile(text: string): Record<string, unknown> {
  const v: unknown = JSON.parse(text)
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new Error(
      'the instructions file must be a JSON object { [prUrl]: PathInstruction[] }'
    )
  return v as Record<string, unknown>
}

/** PURE — the raw list for one PR (anything but a list = none). */
export function instructionsForPr(
  file: Record<string, unknown>,
  url: string
): unknown[] {
  const v = file[url]
  return Array.isArray(v) ? (v as unknown[]) : []
}

/** PURE — the prompt block and the entries sent, as production builds them. */
export function replayPathInstructions(
  raw: unknown,
  coveredPaths: readonly string[]
): RenderedPathInstructions {
  const list: PathInstruction[] = normalizePathInstructions(raw)
  return planPathInstructions(list, coveredPaths, guardPromptLineText)
}

/**
 * PURE — LUM-1210: each finding with `pathInstruction`, the glob production
 * would store for it (`verifyPathInstructionClaim` against the entries SENT
 * in this review), else null. The model's raw `instruction` stays as is.
 */
export function withVerifiedInstructionClaims<
  F extends { filePath: string; instruction?: unknown },
>(
  findings: readonly F[],
  sent: readonly PathInstruction[]
): Array<F & { pathInstruction: string | null }> {
  return findings.map(f => ({
    ...f,
    pathInstruction: verifyPathInstructionClaim(
      f.instruction,
      f.filePath,
      sent,
      guardPromptLineText
    ),
  }))
}
