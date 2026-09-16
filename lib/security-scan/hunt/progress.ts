/**
 * LUM-799 — the no-progress stop for the hunt's tool loop.
 *
 * The checkout the agent reads is a read-only depth-1 clone that nothing
 * writes to for the life of a task, so a command the agent has already run returns
 * the same bytes again. Re-issuing it therefore adds NOTHING to what the
 * model has seen — while costing a full step, because a tool loop re-sends
 * its whole transcript every step.
 *
 * Production (PR 1032, scan 58adbdb): one task alternated
 * `sed -n '25,35p' <file>` and `sed -n '35,45p' <file>` — byte-identical
 * re-runs — for 46 of its 74 steps, each step producing 56 output tokens
 * while the input grew 9,750 → 9,846 → 9,952. It spent 477,248 of the
 * scan's 735,528 tokens and submitted one candidate at the end. No counter
 * was violated: the step cap follows the budget (LUM-758 ×10) and sat well
 * above 74. What was missing was a stop that reads PROGRESS rather than
 * spend.
 *
 * Pure, and deliberately free of `ai`: the client that consumes it statically
 * imports the SDK, which the tests must not (jest TransformStream trap), so
 * the arithmetic lives here and is judged on its own — the same split
 * `budget.ts` and `transcript.ts` already use.
 */

/**
 * The shape this reads out of an SDK step: the tool calls it made, each with
 * the arguments the model sent. Structural on purpose — the SDK's own types
 * cannot be imported here, and nothing else about a step matters.
 */
export interface ProgressStep {
  toolCalls?: ReadonlyArray<{
    toolName?: string | undefined
    input?: unknown
  }>
}

/** The shell tool's name in the hunt loop; the only call that reads anything. */
const SHELL_TOOL = 'run_shell'

/**
 * Whitespace-normalised, never case-folded: paths and flags are
 * case-sensitive, so `-N` and `-n` are different commands, while
 * `sed  -n` and `sed -n` are the same one. Nothing else is rewritten — two
 * commands that differ in quoting genuinely reach the shell differently
 * (`cat "x"` vs `cat 'x'` did in prod), and guessing they are the same is
 * how a detector starts stopping searches that were still working.
 */
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

/** The `run_shell` commands one step asked for, normalised, in order. */
export function commandsOfStep(step: ProgressStep): string[] {
  const out: string[] = []
  for (const call of step.toolCalls ?? []) {
    if (call?.toolName !== SHELL_TOOL) continue
    const input = call.input
    if (input === null || typeof input !== 'object') continue
    const command = (input as { command?: unknown }).command
    if (typeof command !== 'string' || command.trim().length === 0) continue
    out.push(normalizeCommand(command))
  }
  return out
}

/**
 * How many steps in a row, ending at the last one, asked the shell for
 * NOTHING an earlier step had not already asked for.
 *
 * A step counts toward the streak only when it ran at least one command and
 * EVERY command it ran was already issued by an earlier step. Three
 * deliberate consequences:
 *
 *   - one new command clears the streak. A step that re-reads two slices it
 *     has seen and opens a third file is a search narrowing in, not a loop.
 *   - a step that called no shell command at all clears it. That is the
 *     model thinking, or submitting; neither is the failure this reads.
 *   - a command repeated twice INSIDE one step is new the first time and a
 *     repeat the second, exactly as it is across steps.
 */
export function noProgressStreak(steps: ReadonlyArray<ProgressStep>): number {
  const seen = new Set<string>()
  let streak = 0
  for (const step of steps) {
    const commands = commandsOfStep(step)
    if (commands.length === 0) {
      streak = 0
      continue
    }
    let repeatedAll = true
    for (const command of commands) {
      if (!seen.has(command)) repeatedAll = false
      seen.add(command)
    }
    streak = repeatedAll ? streak + 1 : 0
  }
  return streak
}

/**
 * The stop predicate. `threshold <= 0` turns it off — a caller that does not
 * want the stop must be able to say so without the detector reading it as
 * "stop immediately".
 */
export function isNoProgress(
  steps: ReadonlyArray<ProgressStep>,
  threshold: number
): boolean {
  if (threshold <= 0) return false
  return noProgressStreak(steps) >= threshold
}
