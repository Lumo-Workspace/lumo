/** @jest-environment node */
import {
  formatHuntTaskDetail,
  formatShellDetail,
} from '../../shared/src/hunt-audit'
import { formatShellDetail as scriptFormatShellDetail } from '../../scripts/analysis/lum739-hunt-audit/aggregate'

/**
 * LUM-788 — the per-task hunt read-out lives in shared/ so `lumo pr scan
 * --full` and the lum739 audit script print from one implementation.
 */
describe('shared/src/hunt-audit', () => {
  it('is the single implementation the lum739 script re-exports', () => {
    expect(scriptFormatShellDetail).toBe(formatShellDetail)
  })

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
})
