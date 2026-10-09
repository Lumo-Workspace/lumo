/**
 * LUM-937 (decision 2026-10-06): the session timeline renders only the hook
 * event types it understands. Every other HookEventType is skipped — never a
 * blank or duplicate tool row, never a tool call — live, pruned or deleted.
 *
 * Failure variants, per the Claude Code (2.1.186) hook dispatcher:
 * - PostToolUseFailure fires *instead of* PostToolUse when the tool call
 *   throws (`try { call; PostToolUse } catch { PostToolUseFailure }`), with
 *   tool_name, tool_input, tool_use_id, error, is_interrupt — it is that
 *   call's Post, rendered as an error.
 * - StopFailure "fires instead of Stop when an API error ended the turn", with
 *   error, error_details, last_assistant_message — it is that turn's Stop,
 *   rendered as an error.
 */
import { HookEventType as PrismaHookEventType } from '@prisma/client'
import {
  countToolCalls,
  mergeEvents,
  type HookEventType,
  type RawEvent,
} from '@/app/sessions/[id]/merge-events'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'
import {
  buildPrunedPayload,
  buildUserDeletedPayload,
} from '@/lib/hook-event/retention'

const BASE = { session_id: 'sess-1', cwd: '/repo', permission_mode: 'default' }

function at(sec: number): Date {
  return new Date(Date.UTC(2026, 9, 6, 10, 0, sec))
}

function ev(
  id: string,
  type: HookEventType,
  toolName: string | null,
  payload: Record<string, unknown>,
  sec: number
): RawEvent {
  return {
    id,
    type,
    toolName,
    payload: stripCodeFromHookPayload(type, { ...BASE, ...payload }),
    createdAt: at(sec),
  }
}

const BASH_CALL = {
  tool_name: 'Bash',
  tool_use_id: 'toolu_bash',
  tool_input: { command: 'npm test' },
}

/** Real-shaped payloads of the types the timeline does not render. Several
 *  carry tool_name / tool_input / tool_use_id of the call in flight. */
const SKIPPED: Record<string, Record<string, unknown>> = {
  PERMISSION_REQUEST: {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    permission_suggestions: [],
  },
  PERMISSION_DENIED: {
    hook_event_name: 'PermissionDenied',
    ...BASH_CALL,
    reason: 'denied by rule',
  },
  SESSION_START: { hook_event_name: 'SessionStart', source: 'startup' },
  SESSION_END: { hook_event_name: 'SessionEnd', reason: 'exit' },
  SUBAGENT_START: {
    hook_event_name: 'SubagentStart',
    agent_id: 'a1',
    agent_type: 'Explore',
  },
  SUBAGENT_STOP: {
    hook_event_name: 'SubagentStop',
    agent_id: 'a1',
    agent_type: 'Explore',
    last_assistant_message: 'found it',
  },
  WORKTREE_CREATE: { hook_event_name: 'WorktreeCreate', name: 'wt' },
  WORKTREE_REMOVE: {
    hook_event_name: 'WorktreeRemove',
    worktree_path: '/repo/.wt',
  },
  FILE_CHANGED: { hook_event_name: 'FileChanged', file_path: '/repo/a.ts' },
  CONFIG_CHANGE: { hook_event_name: 'ConfigChange', source: 'user' },
  TASK_CREATED: {
    hook_event_name: 'TaskCreated',
    task_id: 't1',
    task_subject: 'x',
  },
  TASK_COMPLETED: {
    hook_event_name: 'TaskCompleted',
    task_id: 't1',
    task_subject: 'x',
  },
  USER_PROMPT_EXPANSION: {
    hook_event_name: 'UserPromptExpansion',
    prompt: '/review',
  },
  NOTIFICATION: {
    hook_event_name: 'Notification',
    message: 'Claude needs your permission',
  },
  ELICITATION: { hook_event_name: 'Elicitation', mcp_server_name: 'm' },
  ELICITATION_RESULT: {
    hook_event_name: 'ElicitationResult',
    mcp_server_name: 'm',
  },
  CWD_CHANGED: { hook_event_name: 'CwdChanged', cwd: '/repo/sub' },
  INSTRUCTIONS_LOADED: {
    hook_event_name: 'InstructionsLoaded',
    file_path: '/repo/CLAUDE.md',
  },
  // LUM-1051: Codex-only events (payload shapes from the LUM-1050 probe).
  PRE_COMPACT: { hook_event_name: 'PreCompact', trigger: 'manual' },
  POST_COMPACT: { hook_event_name: 'PostCompact', trigger: 'manual' },
  INTERRUPT: { hook_event_name: 'Interrupt' },
}

const RENDERED: HookEventType[] = [
  'PRE_TOOL_USE',
  'POST_TOOL_USE',
  'POST_TOOL_USE_FAILURE',
  'STOP',
  'STOP_FAILURE',
  'USER_PROMPT_SUBMIT',
  'POST_TOOL_BATCH',
]

function toolNameOf(payload: Record<string, unknown>): string | null {
  return typeof payload.tool_name === 'string' ? payload.tool_name : null
}

describe('hook event types the session timeline does not render', () => {
  it('covers every HookEventType in the schema', () => {
    const all = Object.values(PrismaHookEventType).sort()
    expect(all).toHaveLength(28)
    expect([...RENDERED, ...Object.keys(SKIPPED)].sort()).toEqual(all)
  })

  it.each(Object.entries(SKIPPED))(
    '%s adds no row and no tool call',
    (type, payload) => {
      const items = mergeEvents([
        ev('e1', type as HookEventType, toolNameOf(payload), payload, 1),
      ])
      expect(items).toEqual([])
      expect(countToolCalls(items)).toBe(0)
    }
  )

  it.each(Object.entries(SKIPPED))(
    '%s does not complete or duplicate the call in flight',
    (type, payload) => {
      const items = mergeEvents([
        ev('pre', 'PRE_TOOL_USE', 'Bash', BASH_CALL, 1),
        ev('x', type as HookEventType, toolNameOf(payload), payload, 2),
        ev(
          'post',
          'POST_TOOL_USE',
          'Bash',
          { ...BASH_CALL, tool_response: { stdout: 'ok', stderr: '' } },
          3
        ),
      ])
      expect(items.map(i => [i.kind, i.toolName, i.status])).toEqual([
        ['tool', 'Bash', 'ok'],
      ])
      expect(countToolCalls(items)).toBe(1)
    }
  )

  it.each(
    Object.keys(SKIPPED).flatMap(type => [
      [type, 'pruned', buildPrunedPayload(at(0), 90)],
      [type, 'deleted', buildUserDeletedPayload(at(0), 'member_1')],
    ])
  )('%s %s adds no row', (type, _label, payload) => {
    const items = mergeEvents([
      {
        id: 'e1',
        type: type as HookEventType,
        toolName: null,
        payload,
        createdAt: at(1),
      },
    ])
    expect(items).toEqual([])
  })
})

describe('cleared events of the rendered types keep their rows', () => {
  it.each([
    ['pruned', buildPrunedPayload(at(0), 90)],
    ['deleted', buildUserDeletedPayload(at(0), 'member_1')],
  ])('%s: prompt, tool, failed tool and stop rows', (_label, payload) => {
    const cleared = (
      id: string,
      type: HookEventType,
      toolName: string | null,
      sec: number
    ): RawEvent => ({ id, type, toolName, payload, createdAt: at(sec) })
    const items = mergeEvents([
      cleared('u', 'USER_PROMPT_SUBMIT', null, 1),
      cleared('a', 'PRE_TOOL_USE', 'Bash', 2),
      cleared('b', 'POST_TOOL_USE', 'Bash', 3),
      cleared('c', 'PRE_TOOL_USE', 'Read', 4),
      cleared('d', 'POST_TOOL_USE_FAILURE', 'Read', 5),
      cleared('e', 'POST_TOOL_BATCH', null, 6),
      cleared('s', 'STOP', null, 7),
      cleared('f', 'STOP_FAILURE', null, 8),
    ])
    expect(items.map(i => [i.kind, i.toolName, i.pruned])).toEqual([
      ['user-prompt', null, true],
      ['tool', 'Bash', true],
      ['tool', 'Read', true],
      ['stop', null, true],
      ['stop', null, true],
    ])
    expect(countToolCalls(items)).toBe(2)
  })
})

describe('PostToolUseFailure is the failed call’s Post', () => {
  const failure = (sec: number, extra: Record<string, unknown> = {}) =>
    ev(
      'fail',
      'POST_TOOL_USE_FAILURE',
      'Bash',
      {
        hook_event_name: 'PostToolUseFailure',
        ...BASH_CALL,
        error: 'Exit code 1\nnpm ERR! Test failed',
        is_interrupt: false,
        duration_ms: 40,
        ...extra,
      },
      sec
    )

  it('pairs with its Pre as one error row showing the error', () => {
    const items = mergeEvents([
      ev('pre', 'PRE_TOOL_USE', 'Bash', BASH_CALL, 1),
      failure(2),
    ])
    expect(items).toHaveLength(1)
    const row = items[0]!
    expect([row.kind, row.toolName, row.status]).toEqual([
      'tool',
      'Bash',
      'error',
    ])
    expect(row.endAt).toEqual(at(2))
    expect(row.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labelKey: 'command', text: 'npm test' }),
        expect.objectContaining({
          labelKey: 'response',
          variant: 'error',
          text: 'Exit code 1\nnpm ERR! Test failed',
        }),
      ])
    )
    expect(countToolCalls(items)).toBe(1)
  })

  it('marks an interrupted call', () => {
    const items = mergeEvents([
      ev('pre', 'PRE_TOOL_USE', 'Bash', BASH_CALL, 1),
      failure(2, { is_interrupt: true, error: 'Interrupted by user' }),
    ])
    expect(items[0]!.status).toBe('error')
    expect(items[0]!.badge).toEqual({ kind: 'interrupted' })
  })

  it('is matched by a batch, which adds nothing to it', () => {
    const items = mergeEvents([
      ev('pre', 'PRE_TOOL_USE', 'Bash', BASH_CALL, 1),
      failure(2),
      ev(
        'batch',
        'POST_TOOL_BATCH',
        null,
        {
          hook_event_name: 'PostToolBatch',
          tool_calls: [{ ...BASH_CALL, tool_response: 'Exit code 1' }],
        },
        3
      ),
    ])
    expect(items).toHaveLength(1)
    expect(countToolCalls(items)).toBe(1)
  })
})

describe('StopFailure is the failed turn’s Stop', () => {
  it('renders a stop row marked as an error with the API error', () => {
    const items = mergeEvents([
      ev(
        'sf',
        'STOP_FAILURE',
        null,
        {
          hook_event_name: 'StopFailure',
          error: 'rate_limit',
          last_assistant_message: 'Working on the fix',
        },
        1
      ),
    ])
    expect(items).toHaveLength(1)
    const row = items[0]!
    expect([row.kind, row.status, row.summary]).toEqual([
      'stop',
      'error',
      'Working on the fix',
    ])
    expect(row.details).toEqual([
      expect.objectContaining({
        labelKey: 'lastMessage',
        text: 'Working on the fix',
      }),
      expect.objectContaining({
        labelKey: 'status',
        variant: 'error',
        text: 'rate_limit',
      }),
    ])
    expect(countToolCalls(items)).toBe(0)
  })
})
