/**
 * Test-case reminders (LUM-807).
 *
 * LUM-801 shipped task test cases (a structured script + an append-only run
 * log) and then nothing pointed at them: the `Next:` rules never mentioned
 * them, and `lumo task status` did not render them at all. A feature nobody is
 * reminded of is a feature nobody uses.
 *
 * The rules live here — pure, no DB — beside `next-steps.ts` for the same
 * reason it does: whether a reminder applies is
 * domain state (test cases × linked PRs × status), and every surface must
 * reach the same verdict from the same inputs. `test-case-reminder.service.ts`
 * fetches the state; the CLI only renders what it is handed.
 *
 * Two gates, deliberately different (LUM-807 design):
 *
 *  - `remindAtStart` — session attach / task context. NO PR gate: at the
 *    moment work begins there is no PR yet, so gating on one would make the
 *    reminder unreachable exactly when it is cheapest to act on.
 *  - `remindOnDelivery` — the `Next:` block and the `task status` advisory. These fire only once a PR exists, because that is
 *    when "what did you actually re-run by hand?" has an answer worth
 *    recording.
 *
 * What this is NOT: a gate. A missing test case never decides whether a task
 * may go DONE (LUM-801). Nothing in this module reaches the blocking path —
 * the `task status` entry is advisory-only.
 */

/** The three facts every reminder decision is made from. */
export interface TestCaseReminderState {
  /** At least one live (non-deleted) test case on the task. */
  hasTestCases: boolean
  /** At least one PR linked to the task. */
  hasLinkedPr: boolean
  /** A delivered task gets no nudges. */
  taskDone: boolean
}

/**
 * Start-of-work reminder gate (session attach / task context). Ungated by PR
 * on purpose — see the module header.
 */
export function remindAtStart(state: TestCaseReminderState): boolean {
  return !state.taskDone && !state.hasTestCases
}

/**
 * Delivery-time reminder gate (`Next:` block, `task status` advisory): a PR exists and the task still has no recorded script.
 */
export function remindOnDelivery(state: TestCaseReminderState): boolean {
  return !state.taskDone && !state.hasTestCases && state.hasLinkedPr
}

const HEADING = '## Test cases'

/**
 * The one command every surface points at. Kept in one place so the
 * reminders can't drift into different invocations of the same command.
 */
export function testCaseAddCommand(taskIdentifier: string): string {
  return `lumo task testcase add ${taskIdentifier} --title "<title>" --step "<step>" --expected "<result>"`
}

/**
 * Start-of-work section. Two lines: what is missing, and what to run. The
 * reminder is resident token cost on every attach — a paragraph explaining
 * the feature would cost more than it buys, and SKILL.md already carries the
 * how.
 */
export function renderTestCaseStartNudge(taskIdentifier: string): string {
  return [
    HEADING,
    '',
    `No test cases on this task yet. Once a re-runnable script exists — steps plus the expected result — record it with \`${testCaseAddCommand(taskIdentifier)}\`.`,
  ].join('\n')
}

/** The `Next:` block entry: same command, one line of why. */
export function testCaseNextStep(taskIdentifier: string): {
  command: string
  why: string
} {
  return {
    command: testCaseAddCommand(taskIdentifier),
    why: 'A PR is open and no test case is recorded — capture the script you verify by hand',
  }
}

/** Statement for the `task status` advisory row. */
export const TEST_CASE_ADVISORY_STATEMENT =
  'No test case recorded on a task that already has a PR — the manual script behind it is not re-runnable by anyone else'
