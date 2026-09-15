/**
 * LUM-787 — the per-STEP output ledger.
 *
 * `runHuntShell` caps one command's output at HUNT_SHELL_OUTPUT_MAX; nothing
 * capped what one step's commands returned TOGETHER, and the model fires
 * several in parallel. In prod (PR 1008) one step returned 25–36k characters
 * across six to eight commands, every later step re-sent all of it, and the
 * predictive stop ended three of three tasks at step 2.
 *
 * The ledger is a running total for the step in flight. Each result is
 * admitted into what is left of HUNT_STEP_OUTPUT_MAX; a result that does not
 * fit is cut to the room left and carries a note telling the model why — a
 * silently shortened result reads as a file that ends there. Parallel
 * results arrive in whatever order the sandbox answers, so which command
 * gets cut is not deterministic; what IS deterministic is the ceiling.
 *
 * Pure and dependency-light: the service resets the ledger on each step
 * boundary (`onStep`) and records the clip in the task audit.
 */
import { HUNT_STEP_OUTPUT_MAX } from '@/lib/services/security-hunt.config'

export interface StepOutputLedger {
  /** Characters admitted so far in the step in flight. */
  used: number
}

export interface AdmittedOutput {
  output: string
  /** The output was cut by the ceiling. */
  clipped: boolean
  /** Characters of the original output that did not reach the model. */
  dropped: number
}

/**
 * Two jobs for one number. Below this much room a cut result would be a
 * fragment too short to read and a note longer than the fragment: return the
 * note alone and let the model re-run the command by itself next step. And
 * an output no longer than this is admitted whatever the ledger says: a
 * 60-character `rg -n` hit is the thing the search is for, and replacing it
 * with a 150-character note would cost more than admitting it. The ceiling
 * can therefore be overshot by at most this much per small command.
 */
export const STEP_CLIP_MIN_CHARS = 200

export function newStepLedger(): StepOutputLedger {
  return { used: 0 }
}

/**
 * The note the model sees in place of what was cut. It names the ceiling in
 * characters so the next step's commands can be sized to it, and says how to
 * recover — re-run alone — because the model has no other way to learn that
 * the cut was about the STEP and not about this command.
 */
export function stepClipNote(dropped: number, max: number): string {
  return `\n[step output ceiling: this step's commands together exceeded ${max} characters, so ${dropped} characters of this output were cut. Run fewer or narrower commands per step; re-run this one alone if you need it.]`
}

/**
 * Admit one command's output into the step. Mutates `ledger.used`.
 *
 * An output that fits is returned byte-identical — a step under the ceiling
 * must be indistinguishable from a step before this existed. A denied or
 * failed command returns '' and costs the ledger nothing.
 */
export function admitStepOutput(
  ledger: StepOutputLedger,
  output: string,
  max: number = HUNT_STEP_OUTPUT_MAX
): AdmittedOutput {
  const room = Math.max(0, max - ledger.used)
  if (output.length <= room || output.length <= STEP_CLIP_MIN_CHARS) {
    ledger.used += output.length
    return { output, clipped: false, dropped: 0 }
  }
  // Not enough room for a readable fragment: the note alone.
  if (room < STEP_CLIP_MIN_CHARS) {
    ledger.used = max
    return {
      output: stepClipNote(output.length, max).trimStart(),
      clipped: true,
      dropped: output.length,
    }
  }
  const kept = output.slice(0, room)
  ledger.used = max
  return {
    output: `${kept}${stepClipNote(output.length - kept.length, max)}`,
    clipped: true,
    dropped: output.length - kept.length,
  }
}
