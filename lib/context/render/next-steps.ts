/**
 * Next-step suggestions (LUM-686).
 *
 * The CLI used to answer "what do I do now?" in scattered, hand-written lines
 * — `next.ts` hard-coded its own `Next:` string, `task create` said nothing at
 * all. Whether a suggestion applies depends on task status × contract × session
 * binding × verify round, which is domain state, so the rules live here beside
 * the other context renderers (`renderCriteriaDraftNudge` is the same shape and
 * predates this module) and ride down on the API response. The CLI only renders.
 */

export type TaskStatusForNextSteps =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'DONE'

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
  hasCriteria: boolean
  sessionBound: boolean
  /** Count of OPEN boundary crossings on the task. */
  openCrossings: number
  /** Verification rounds already spent (0 = never verified). */
  verifyRound: number
  hasUnmetCriteria: boolean
  /**
   * True when the caller's response already carries the criteria draft nudge
   * (`session attach`, `task context`). Suppresses the duplicate suggestion —
   * the same advice twice on one screen is exactly the noise the cap fights.
   */
  criteriaNudgeAlreadyShown: boolean
}

/**
 * Hard cap on suggestions per render. Hints are resident token cost paid on
 * every command, and a cost that buys nothing is worse than silence — the same
 * reasoning behind the CLAUDE.md soft budget. Three is the ceiling, not a goal.
 */
export const NEXT_STEPS_MAX = 3

/** Round cap of the verification loop; past it the task escalates to a human. */
const VERIFY_ROUND_CAP = 3

/**
 * Ordered rule table. Earlier entries win the cap, so the ordering encodes
 * priority: blockers first, then the contract, then routine progress.
 */
export function computeNextSteps(input: NextStepsInput): NextStep[] {
  const {
    taskIdentifier: id,
    status,
    hasCriteria,
    sessionBound,
    openCrossings,
    verifyRound,
    hasUnmetCriteria,
    criteriaNudgeAlreadyShown,
  } = input

  // A delivered task has nothing to suggest; adjudication is human-only.
  if (status === 'DONE') return []

  const steps: NextStep[] = []

  // An open crossing blocks Done — it outranks anything else the agent
  // might do next.
  if (openCrossings > 0) {
    steps.push({
      command: `lumo crossing explain ${id} --note "<text>"`,
      why: `${openCrossings} open boundary crossing${
        openCrossings === 1 ? '' : 's'
      } — explain them (a human dispositions them on the web)`,
    })
  }

  // IN_REVIEW is a full stop: the round landed and the verdict is a human's.
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

  // Suppressed when the response already renders the draft nudge — see
  // `criteriaNudgeAlreadyShown`.
  if (!hasCriteria && !criteriaNudgeAlreadyShown) {
    steps.push({
      command: `lumo task criteria set ${id} --file <criteria.json>`,
      why: 'Draft the acceptance contract before writing the first line of code',
    })
  }

  // A rejected round: read what is still unmet before touching code again.
  if (verifyRound > 0 && hasUnmetCriteria && verifyRound < VERIFY_ROUND_CAP) {
    steps.push({
      command: `lumo task status ${id}`,
      why: `Round ${verifyRound} left criteria unmet — read them before re-verifying`,
    })
  }

  // With a contract in hand, verification is the way out of IN_PROGRESS.
  if (hasCriteria && (status === 'TODO' || status === 'IN_PROGRESS')) {
    steps.push({
      command: 'lumo verify --note "<self-report>"',
      why: 'Run the machine acceptance loop before claiming the task is done',
    })
  }

  return steps.slice(0, NEXT_STEPS_MAX)
}
