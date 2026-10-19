/** @jest-environment node */
import {
  formatHuntTaskDetail,
  formatShellDetail,
  readHuntSubmission,
} from '../../shared/src/hunt-audit'

/**
 * LUM-788 — the per-task hunt read-out lives in shared/ so `lumo pr scan
 * --full` and the hunt audit tooling print from one implementation.
 */
describe('shared/src/hunt-audit', () => {
  it('formatHuntTaskDetail prints an idle task (no shell calls) with its stop, sites and model', () => {
    const lines = formatHuntTaskDetail(
      [
        {
          taskId: 't2',
          stopped: 'steps',
          sites: 3,
          model: 'alibaba/qwen3-coder-plus',
          stop: {
            by: 'steps',
            spent: 18_200,
            budget: 30_000,
            reserve: 4_000,
            lastStep: 6_100,
            steps: 2,
          },
        },
      ],
      6
    )
    expect(lines[0]).toBe(
      't2 steps · alibaba/qwen3-coder-plus · 3 sites · no shell commands'
    )
    expect(lines[1]).toBe(
      '    stop: steps · spent 18200/30000 · reserve 4000 · last step 6100 · 2 steps'
    )
  })

  it('formatHuntTaskDetail keeps a pre-LUM-787 row free of sites/model and caps the task count', () => {
    const lines = formatHuntTaskDetail(
      [
        {
          taskId: 't1',
          stopped: 'done',
          sites: 1,
          shell: { calls: 1, refused: 0, failed: 0, empty: 1, commands: [] },
        },
        { taskId: 'old', stopped: 'budget', shell: { calls: 2, commands: [] } },
        { taskId: 'cut', stopped: 'done' },
      ],
      2
    )
    expect(lines).toEqual([
      't1 done · 1 sites · 1 cmds (gate refused 0, sandbox failed 0, not found 0, empty 1)',
      'old budget · 2 cmds (gate refused 0, sandbox failed 0, not found 0, empty 0)',
    ])
  })

  it('formatShellDetail still skips tasks that never asked the shell for anything', () => {
    const lines = formatShellDetail(
      [
        { taskId: 'idle', stopped: 'steps', model: 'm' },
        {
          taskId: 't1',
          stopped: 'done',
          shell: { calls: 1, commands: [{ cmd: 'rg -n x lib/' }] },
        },
      ],
      6
    )
    expect(lines.join('\n')).not.toContain('idle')
    expect(lines[1]).toBe('      rg -n x lib/')
  })

  it('LUM-799 no-progress repeat counters print in the per-task read-out', () => {
    const lines = formatHuntTaskDetail(
      [
        {
          taskId: 't2',
          stopped: 'no-progress',
          sites: 1,
          model: 'alibaba/qwen3-coder-plus',
          shell: {
            calls: 24,
            refused: 0,
            failed: 0,
            notFound: 0,
            empty: 1,
            repeated: 6,
            commands: [],
          },
          stop: {
            by: 'no-progress',
            spent: 99_000,
            budget: 666_666,
            reserve: 5_000,
            lastStep: 5_000,
            steps: 24,
            repeatSteps: 3,
          },
        },
        // A row from before the counters existed, and one that never repeated
        // a command: both must print exactly as they always did.
        {
          taskId: 't3',
          stopped: 'done',
          shell: { calls: 4, refused: 0, failed: 0, empty: 0, commands: [] },
          stop: { by: 'submitted', spent: 9_000, budget: 30_000, steps: 4 },
        },
      ],
      6
    )
    expect(lines[0]).toBe(
      't2 no-progress · alibaba/qwen3-coder-plus · 1 sites · 24 cmds (gate refused 0, sandbox failed 0, not found 0, empty 1, repeated 6)'
    )
    expect(lines[1]).toBe(
      '    stop: no-progress · spent 99000/666666 · reserve 5000 · last step 5000 · 24 steps · 3 repeat steps'
    )
    expect(lines[2]).toBe(
      't3 done · 4 cmds (gate refused 0, sandbox failed 0, not found 0, empty 0)'
    )
    expect(lines[3]).toBe(
      '    stop: submitted · spent 9000/30000 · reserve 0 · last step ? · 4 steps'
    )
  })

  it('LUM-1224 prints a per-task prompt-cache summary after the trace steps', () => {
    const lines = formatHuntTaskDetail(
      [
        {
          taskId: 't1',
          stopped: 'done',
          trace: [
            {
              i: 1,
              tool: 'run_shell',
              inputTokens: 5_000,
              cacheWriteTokens: 4_200,
              outputTokens: 200,
            },
            {
              i: 2,
              tool: 'submit_candidates',
              inputTokens: 6_000,
              cacheReadTokens: 4_200,
              cacheWriteTokens: 900,
              outputTokens: 150,
            },
          ],
          stop: { by: 'submitted', spent: 11_350, budget: 30_000, steps: 2 },
        },
        // A task whose steps carry no cache counters (an older row, or a
        // provider that reports none) prints exactly as before.
        {
          taskId: 't2',
          stopped: 'done',
          trace: [{ i: 1, tool: 'run_shell', inputTokens: 3_000 }],
        },
      ],
      6
    )
    expect(lines).toEqual([
      't1 done · no shell commands',
      // The per-step lines are unchanged.
      '    #1 tool=run_shell in=5000 out=200',
      '    #2 tool=submit_candidates in=6000 out=150',
      '    cache: read 4200 / write 5100 of 11000 input',
      '    stop: submitted · spent 11350/30000 · reserve 0 · last step ? · 2 steps',
      't2 done · no shell commands',
      '    #1 tool=run_shell in=3000 out=?',
    ])
  })

  it('LUM-1224 prints the cache line when the counters were reported as zero', () => {
    // Zero is a measurement (the prefix was under the cache minimum), not an
    // absence — the reader needs to see it to tell the two apart.
    const lines = formatHuntTaskDetail(
      [
        {
          taskId: 't1',
          stopped: 'done',
          trace: [
            {
              i: 1,
              inputTokens: 2_900,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 100,
            },
          ],
        },
      ],
      6
    )
    expect(lines).toContain('    cache: read 0 / write 0 of 2900 input')
  })

  it('LUM-1226 prints a task’s candidate submission line after its stop and wrap-up', () => {
    const lines = formatHuntTaskDetail(
      [
        {
          taskId: 't1',
          stopped: 'done',
          stop: { by: 'submitted', spent: 9000, budget: 30000, steps: 4 },
          wrapUp: { ran: false, skipped: 'submitted' },
          submission: {
            calls: 1,
            submitted: 3,
            kept: 2,
            dropped: 1,
            reasons: ['cwe', 'call_chain.from'],
          },
        },
        {
          taskId: 't2',
          stopped: 'done',
          submission: { calls: 2, submitted: 0, kept: 0, dropped: 0 },
        },
        // An older row without the field prints exactly as before.
        { taskId: 't3', stopped: 'done' },
      ],
      6
    )
    expect(lines).toEqual([
      't1 done · no shell commands',
      '    stop: submitted · spent 9000/30000 · reserve 0 · last step ? · 4 steps',
      '    wrap-up: not made (submitted)',
      '    candidates: submitted 3 · kept 2 · dropped 1 (reasons: cwe, call_chain.from)',
      't2 done · no shell commands',
      '    candidates: submitted 0 · kept 0 · dropped 0 · 2 calls',
      't3 done · no shell commands',
    ])
  })

  it('LUM-1226 readHuntSubmission keeps numbers and field-name reasons only', () => {
    expect(readHuntSubmission(undefined)).toBeUndefined()
    expect(readHuntSubmission('x')).toBeUndefined()
    expect(readHuntSubmission({ kept: 'lots' })).toBeUndefined()
    expect(
      readHuntSubmission({
        calls: 1,
        submitted: 2,
        kept: 2,
        dropped: 0,
        reasons: [],
        extra: 'free text',
      })
    ).toEqual({ calls: 1, submitted: 2, kept: 2, dropped: 0 })
    expect(
      readHuntSubmission({
        submitted: 1,
        kept: 0,
        dropped: 1,
        reasons: ['limit', 'a b', 7, 'x'.repeat(65), 'precondition'],
      })
    ).toEqual({
      submitted: 1,
      kept: 0,
      dropped: 1,
      reasons: ['limit', 'precondition'],
    })
  })
})
