/**
 * Next-step suggestions (LUM-686).
 *
 * The CLI used to answer "what do I do now?" in scattered, hand-written lines
 * — `next.ts` hard-coded its own `Next:` string, `task create` said nothing at
 * all. Whether a suggestion applies depends on task status × session binding ×
 * open crossings × test-case state, which is domain state, so the rules live
 * here beside the other context renderers and ride down on the API response.
 * The CLI only renders.
 */

import {
  remindOnDelivery,
  testCaseNextStep,
  type TestCaseReminderState,
} from './test-case-reminder'

export type TaskStatusForNextSteps =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'DONE'
  | 'CANCELED'

/**
 * One suggestion. `command` is null for advice that has no command to run —
 * IN_REVIEW means "stop and wait for a human", not "run something".
 */
export interface NextStep {
  command: string | null
  why: string
}

export interface NextStepsInput {
  taskIdentifier: string
  status: TaskStatusForNextSteps
  sessionBound: boolean
  /** Count of OPEN boundary crossings on the task. */
  openCrossings: number
  /**
   * LUM-807: test-case reminder state. The rule below fires only on the
   * delivery-time gate (a PR exists, no script recorded); `remindOnDelivery`
   * in `test-case-reminder.ts` owns that decision so the `Next:` block, the
   * verify line and the `task status` advisory can never disagree.
   */
  testCase?: TestCaseReminderState | undefined
  /**
   * True when the same response already renders the start-of-work test-case
   * section (`session attach`, `task context`) — the same advice twice on one
   * screen is exactly the noise the cap fights.
   */
  testCaseNudgeAlreadyShown?: boolean | undefined
}

/**
 * Hard cap on suggestions per render. Hints are resident token cost paid on
 * every command, and a cost that buys nothing is worse than silence — the same
 * reasoning behind the CLAUDE.md soft budget. Three is the ceiling, not a goal.
 */
export const NEXT_STEPS_MAX = 3

/**
 * Ordered rule table. Earlier entries win the cap, so the ordering encodes
 * priority: blockers first, then routine progress.
 */
export function computeNextSteps(input: NextStepsInput): NextStep[] {
  const {
    taskIdentifier: id,
    status,
    sessionBound,
    openCrossings,
    testCase,
    testCaseNudgeAlreadyShown,
  } = input

  // A delivered task has nothing to suggest; adjudication is human-only.
  if (status === 'DONE') return []

  // LUM-1282: a canceled task is closed by a human ruling — no work is left,
  // and reopening it is the user's call, not the agent's.
  if (status === 'CANCELED') {
    return [
      {
        command: null,
        why: "This task is CANCELED — stop here; reopening it is the user's call.",
      },
    ]
  }

  const steps: NextStep[] = []

  // An open crossing blocks Done — it outranks anything else the agent
  // might do next.
  if (openCrossings > 0) {
    steps.push({
      command: `lumo crossing explain <id> --task ${id} --note "<text>"`,
      why: `${openCrossings} open boundary crossing${
        openCrossings === 1 ? '' : 's'
      } — explain them (a human dispositions them on the web)`,
    })
  }

  // IN_REVIEW is a full stop: the work is delivered and the verdict is a human's.
  // Nothing below applies, so return once the crossing rule has had its say.
  if (status === 'IN_REVIEW') {
    steps.push({
      command: null,
      why: 'This task is IN_REVIEW — stop here and wait for the human verdict.',
    })
    return steps.slice(0, NEXT_STEPS_MAX)
  }

  if (!sessionBound) {
    steps.push({
      command: `lumo session attach ${id}`,
      why: 'Bind this session to the task so its work is recorded against it',
    })
  }

  // LUM-807, last on purpose: recording a script is routine progress, never a
  // blocker. It yields the cap to the rules above — and stays silent when the same response already renders the start-of-work
  // test-case section.
  if (
    testCase !== undefined &&
    !testCaseNudgeAlreadyShown &&
    remindOnDelivery(testCase)
  ) {
    steps.push(testCaseNextStep(id))
  }

  return steps.slice(0, NEXT_STEPS_MAX)
}
