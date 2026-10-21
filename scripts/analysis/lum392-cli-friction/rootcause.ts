/**
 * LUM-413: root-cause layer — Winston & Just's six fixable-component root
 * causes (A Taxonomy of Failures in Tool-Augmented LLMs, AST 2025), mapped
 * onto each non-valid invocation:
 *
 *   R1 tool selection        — the agent picked the wrong (or nonexistent) tool
 *   R2 input construction    — arguments/flags/values built wrong
 *   R3 output parsing        — result misread by the caller
 *   R4 constrained decoding  — structured-output decoding failure (n/a for a
 *                              shell CLI surface; never auto-suggested)
 *   R5 tool set / docs       — the toolset or its documentation misled
 *   R6 tool error            — the tool itself failed
 *
 * This layer is suggestion-only: every row carries a confidence marker and
 * the report keeps it as a human/LLM-review worksheet (the paper's labels
 * are human labels; we automate the obvious mappings and flag the rest).
 * The one genuinely automatic disambiguation: a hallucinated flag that IS
 * documented in the lumo skill docs is a docs-drift problem (R5), not the
 * agent inventing input (R2).
 */
import type { ResultClass } from './attribute'

export type RootCause =
  | 'R1_TOOL_SELECTION'
  | 'R2_INPUT_CONSTRUCTION'
  | 'R3_OUTPUT_PARSING'
  | 'R4_CONSTRAINED_DECODING'
  | 'R5_TOOLSET_DOCS'
  | 'R6_TOOL_ERROR'

export interface RootCauseSuggestion {
  cause: RootCause
  confidence: 'auto' | 'needs-review'
  rationale: string
}

export interface RootCauseInput {
  resultClass: ResultClass
  reason: string
  errorKind: string | null
  evidence: string | null
  maskedFailure: boolean
  /** AST-offending token (hallucinated flag/subcommand), when present. */
  astOffending: string | null
  /** Whether the offending token appears in cli/skill docs. */
  offendingInSkillDocs: boolean
}

/** Errors whose message gives the agent an actionable next step. */
const ACTIONABLE_ERROR_RE =
  /--help|run `|use `|try `|did you mean|valid (flags|values|options)|expected one of/i

/**
 * Suggest a Winston root cause for one non-valid invocation. Returns null
 * for valid/redundant classes (redundancy is agent behavior, not a tool
 * failure — it feeds the self-conditioning check instead) and for
 * interrupted calls (agent abort, no component to fix).
 */
export function suggestRootCause(
  r: RootCauseInput
): RootCauseSuggestion | null {
  if (r.resultClass === 'valid-result' || r.resultClass === 'redundant-valid') {
    return null
  }
  if (r.errorKind === 'interrupted') return null

  if (r.resultClass === 'selection-error') {
    if (r.offendingInSkillDocs) {
      return {
        cause: 'R5_TOOLSET_DOCS',
        confidence: 'auto',
        rationale: `nonexistent command "${r.astOffending}" is mentioned in skill docs — docs drift`,
      }
    }
    return {
      cause: 'R1_TOOL_SELECTION',
      confidence: 'needs-review',
      rationale: 'invoked a command that does not exist (not present in docs)',
    }
  }

  if (r.resultClass === 'usage-error') {
    if (r.reason.startsWith('ast:unknown-flag')) {
      return r.offendingInSkillDocs
        ? {
            cause: 'R5_TOOLSET_DOCS',
            confidence: 'auto',
            rationale: `hallucinated flag "${r.astOffending}" is mentioned in skill docs — docs drift`,
          }
        : {
            cause: 'R2_INPUT_CONSTRUCTION',
            confidence: 'auto',
            rationale: `flag "${r.astOffending}" exists nowhere — invented input`,
          }
    }
    if (r.reason.startsWith('ast:illegal-enum')) {
      return {
        cause: 'R2_INPUT_CONSTRUCTION',
        confidence: 'auto',
        rationale: `value "${r.astOffending}" outside the documented enum`,
      }
    }
    return {
      cause: 'R2_INPUT_CONSTRUCTION',
      confidence: 'needs-review',
      rationale: 'runtime input/validation error',
    }
  }

  // invalid-result
  if (r.maskedFailure) {
    return {
      cause: 'R6_TOOL_ERROR',
      confidence: 'needs-review',
      rationale:
        'exit 0 with empty output (masked failure) — could be R3 if the output was fine but unread',
    }
  }
  if (r.errorKind === 'not-found') {
    return {
      cause: 'R6_TOOL_ERROR',
      confidence: 'auto',
      rationale: 'lumo binary missing from the environment',
    }
  }
  const actionable = r.evidence ? ACTIONABLE_ERROR_RE.test(r.evidence) : false
  return {
    cause: 'R6_TOOL_ERROR',
    confidence: 'needs-review',
    rationale: actionable
      ? 'tool-side error with an actionable message'
      : 'tool-side error whose message gives no next step — R5 candidate (error does not point the way)',
  }
}
