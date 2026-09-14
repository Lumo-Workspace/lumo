/**
 * @jest-environment node
 */
import {
  formatNextSteps,
  emitNextSteps,
  nextStepsSilenced,
  type NextStep,
} from '@/cli/src/lib/next-steps'
import { formatCreateOutput } from '@/cli/src/commands/task-create'
import { computeNextSteps } from '@/lib/context/render/next-steps'

// The mute is read from the environment (`LUMO_NO_HINTS`). Pin these tests to
// an unmuted env so a caller's shell can't flip their outcome.
const OLD_NO_HINTS = process.env.LUMO_NO_HINTS
beforeEach(() => {
  delete process.env.LUMO_NO_HINTS
})
afterAll(() => {
  if (OLD_NO_HINTS !== undefined) process.env.LUMO_NO_HINTS = OLD_NO_HINTS
})

/** Collects writes so a test can assert on a stream without touching the real one. */
function sink() {
  const chunks: string[] = []
  return { write: (s: string) => chunks.push(s), text: () => chunks.join('') }
}

const CREATED_TASK = {
  id: 'c1',
  identifier: 'LUM-686',
  title: 'Unify CLI next-step hints',
  url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-686',
}

describe('next-step rendering', () => {
  it('task create appends attach and criteria next steps', () => {
    // A task fresh out of `task create`: nothing bound, no contract, and no
    // criteria nudge in the response (that surface belongs to attach/context).
    const steps = computeNextSteps({
      taskIdentifier: 'LUM-686',
      status: 'TODO',
      hasCriteria: false,
      sessionBound: false,
      openCrossings: 0,
      verifyRound: 0,
      hasUnmetCriteria: false,
      criteriaNudgeAlreadyShown: false,
    })

    // Goes through the command's own composer — a test that re-assembled the
    // parts here would stay green even if `task create` never wired them up.
    const text = formatCreateOutput(CREATED_TASK, steps, {}, {})

    // The result line stays first and byte-identical — anything reading line 1
    // of `task create` keeps working.
    expect(text.split('\n')[0]).toBe(
      'Created LUM-686 "Unify CLI next-step hints"  https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-686'
    )
    expect(text).toContain('lumo session attach LUM-686')
    expect(text).toContain('lumo task criteria set LUM-686')
  })

  it('task update emits status-matched next steps', () => {
    const base = {
      taskIdentifier: 'LUM-686',
      hasCriteria: true,
      sessionBound: true,
      openCrossings: 0,
      verifyRound: 0,
      hasUnmetCriteria: false,
      criteriaNudgeAlreadyShown: false,
    }

    const inProgress = sink()
    emitNextSteps(
      computeNextSteps({ ...base, status: 'IN_PROGRESS' }),
      {},
      inProgress
    )
    expect(inProgress.text()).toContain('lumo verify')

    const inReview = sink()
    emitNextSteps(
      computeNextSteps({ ...base, status: 'IN_REVIEW' }),
      {},
      inReview
    )
    // IN_REVIEW is a stop, not a command to run.
    expect(inReview.text()).toMatch(/IN_REVIEW/)
    expect(inReview.text()).not.toContain('lumo verify')

    // A delivered task has nothing left to suggest.
    const done = sink()
    emitNextSteps(computeNextSteps({ ...base, status: 'DONE' }), {}, done)
    expect(done.text()).toBe('')
  })

  it('next steps are fully silenced by env and flag', () => {
    const steps: NextStep[] = [
      { command: 'lumo verify --note "<self-report>"', why: 'run the loop' },
    ]

    const viaEnv = sink()
    emitNextSteps(steps, {}, viaEnv, { LUMO_NO_HINTS: '1' })
    expect(viaEnv.text()).toBe('')

    const viaFlag = sink()
    emitNextSteps(steps, { hints: false }, viaFlag, {})
    expect(viaFlag.text()).toBe('')

    // Unset and "0" are not mute — only an explicit opt-out silences.
    const loud = sink()
    emitNextSteps(steps, {}, loud, { LUMO_NO_HINTS: '0' })
    expect(loud.text()).toContain('lumo verify')

    expect(nextStepsSilenced({ LUMO_NO_HINTS: '1' }, {})).toBe(true)
    expect(nextStepsSilenced({}, { hints: false })).toBe(true)
    expect(nextStepsSilenced({}, {})).toBe(false)
  })

  it('next steps never reach stderr on the success path', () => {
    const steps: NextStep[] = [
      { command: 'lumo session attach LUM-686', why: 'bind the session' },
    ]
    const out = sink()
    const err = sink()

    // emitNextSteps takes the destination explicitly; give it stdout and prove
    // nothing leaks to the error stream.
    emitNextSteps(steps, {}, out, {})

    expect(out.text()).toContain('lumo session attach LUM-686')
    expect(err.text()).toBe('')

    // Guard the real default too: the module must not write to process.stderr.
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    try {
      emitNextSteps(steps, {}, undefined, {})
      expect(stderrSpy).not.toHaveBeenCalled()
      expect(stdoutSpy).toHaveBeenCalled()
    } finally {
      stderrSpy.mockRestore()
      stdoutSpy.mockRestore()
    }
  })

  it('migrated Next blocks keep their original suggestions', () => {
    // `worktree add` and `setup` have no server round-trip — they build the
    // same NextStep shape locally and hand it to the shared renderer.
    const worktree = formatNextSteps([
      {
        command: 'cd /repo/.worktrees/LUM-686',
        why: 'work from the isolated checkout',
      },
    ])
    expect(worktree).toContain('cd /repo/.worktrees/LUM-686')
    expect(worktree.startsWith('Next:')).toBe(true)

    const setup = formatNextSteps([
      { command: 'lumo auth login', why: 'paste an API key' },
      { command: 'lumo next', why: 'see what to work on' },
    ])
    expect(setup).toContain('lumo auth login')
    expect(setup).toContain('lumo next')

    // `lumo next` keeps recommending attach + context for the top task, now
    // through the same renderer instead of its own hand-written string.
    const next = formatNextSteps([
      {
        command: 'lumo session attach LUM-686 && lumo task context LUM-686',
        why: 'start on the recommended task',
      },
    ])
    expect(next).toContain('lumo session attach LUM-686')
    expect(next).toContain('lumo task context LUM-686')

    // One heading for the whole block, whatever the source.
    expect(setup.match(/Next:/g)).toHaveLength(1)
  })
})
