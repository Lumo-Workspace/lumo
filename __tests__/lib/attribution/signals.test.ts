/**
 * @jest-environment node
 */
import { extractAttributionSignals } from '@/lib/attribution/signals'

const bash = (command: string, extra: Record<string, unknown> = {}) => ({
  tool_name: 'Bash',
  tool_input: { command },
  ...extra,
})

describe('extractAttributionSignals', () => {
  it('BRANCH from _lumo_branch on any event, keeping the raw branch', () => {
    expect(
      extractAttributionSignals('STOP', { _lumo_branch: 'lumo/LUM-12-x' })
    ).toEqual([
      { kind: 'BRANCH', identifier: 'LUM-12', branch: 'lumo/LUM-12-x' },
    ])
    expect(
      extractAttributionSignals('STOP', { _lumo_branch: 'feature/login' })
    ).toEqual([{ kind: 'BRANCH', branch: 'feature/login' }])
    expect(extractAttributionSignals('STOP', { _lumo_branch: 'main' })).toEqual(
      []
    )
  })

  it('LUMO_CMD takes the first id of each lumo segment on PRE_TOOL_USE only', () => {
    const p = bash(
      'cd /r && lumo verify LUM-12 && lumo task deps add LUM-13 --blocked-by LUM-14'
    )
    expect(extractAttributionSignals('PRE_TOOL_USE', p)).toEqual([
      { kind: 'LUMO_CMD', identifier: 'LUM-12' },
      { kind: 'LUMO_CMD', identifier: 'LUM-13' },
    ])
    expect(extractAttributionSignals('POST_TOOL_USE', p)).toEqual([])
    expect(
      extractAttributionSignals(
        'PRE_TOOL_USE',
        bash('./node_modules/.bin/lumo task status LUM-7')
      )
    ).toEqual([{ kind: 'LUMO_CMD', identifier: 'LUM-7' }])
    expect(
      extractAttributionSignals(
        'PRE_TOOL_USE',
        bash('echo "lumo verify LUM-9"')
      )
    ).toEqual([])
  })

  it('COMMIT takes bracketed ids from git commit; PR_CREATE takes ids from gh pr create', () => {
    expect(
      extractAttributionSignals(
        'PRE_TOOL_USE',
        bash('git add -A && git commit -m "feat: x [LUM-12]"')
      )
    ).toEqual([{ kind: 'COMMIT', identifier: 'LUM-12' }])
    expect(
      extractAttributionSignals(
        'PRE_TOOL_USE',
        bash('git commit -m "mentions LUM-3 without brackets"')
      )
    ).toEqual([])
    expect(
      extractAttributionSignals(
        'PRE_TOOL_USE',
        bash('gh pr create --title "feat: y [LUM-12]" --body b')
      )
    ).toEqual([{ kind: 'PR_CREATE', identifier: 'LUM-12' }])
  })

  it('PROMPT takes every id in a user prompt', () => {
    expect(
      extractAttributionSignals('USER_PROMPT_SUBMIT', {
        prompt: '现在做 LUM-13,参考 LUM-8',
      })
    ).toEqual([
      { kind: 'PROMPT', identifier: 'LUM-13' },
      { kind: 'PROMPT', identifier: 'LUM-8' },
    ])
  })

  it('GIT_HINT from the CLI session-start hint', () => {
    expect(
      extractAttributionSignals('SESSION_START', { _lumo_git_task: 'lum-21' })
    ).toEqual([{ kind: 'GIT_HINT', identifier: 'LUM-21' }])
  })

  it('AGENT_PROMPT from an Agent tool call, tagged with the spawned agent id', () => {
    const p = {
      tool_name: 'Agent',
      tool_input: { prompt: 'Work on LUM-13. Attach first.' },
      tool_response: { agentId: 'abeaba01ea909a7ee' },
    }
    expect(extractAttributionSignals('POST_TOOL_USE', p)).toEqual([
      {
        kind: 'AGENT_PROMPT',
        identifier: 'LUM-13',
        agentId: 'abeaba01ea909a7ee',
      },
    ])
    expect(
      extractAttributionSignals('POST_TOOL_USE', { ...p, tool_response: {} })
    ).toEqual([])
  })

  it('never throws on junk', () => {
    expect(extractAttributionSignals('PRE_TOOL_USE', null)).toEqual([])
    expect(
      extractAttributionSignals('PRE_TOOL_USE', {
        tool_name: 'Bash',
        tool_input: { command: 42 },
      })
    ).toEqual([])
  })
})
