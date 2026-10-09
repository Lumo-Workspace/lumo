import type { IntlShape } from 'react-intl'
import type { AgentRunHookEventItem, AgentRunHookEventType } from '../../types'
import {
  isPrunedPayload,
  isUserDeletedPayload,
} from '@/lib/hook-event/retention'
import {
  APPLY_PATCH_TOOL,
  parseApplyPatch,
} from '../../../../../shared/src/apply-patch'

/**
 * Visual category for a single agent hook event. Drives icon color and
 * dot color in the timeline. Categories are grouped by "actor":
 *   - Agent (blue family)   — read/write/exec/plan/other tool calls
 *   - Human (muted)         — prompts and explicit user input
 *   - System (violet/amber) — memory sediment, permission interception
 *   - Boundary (muted)      — session/subagent lifecycle markers
 */
export type EventCategory =
  | 'tool_read'
  | 'tool_write'
  | 'tool_exec'
  | 'tool_plan'
  | 'tool_other'
  | 'tool_failure'
  | 'permission_pause'
  | 'permission_denied'
  | 'human_input'
  | 'turn_end'
  | 'turn_failure'
  | 'session_boundary'
  | 'subagent_boundary'
  | 'worktree'
  | 'file_changed'
  | 'config_change'
  | 'task_event'
  | 'notification'

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
// LUM-1051: `apply_patch` is Codex's only file-writing tool; Codex spawns and
// waits on subagents with `collaborationspawn_agent` / `…wait_agent`.
const WRITE_TOOLS = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  APPLY_PATCH_TOOL,
])
const EXEC_TOOLS = new Set([
  'Bash',
  'Task',
  'collaborationspawn_agent',
  'collaborationwait_agent',
])
const PLAN_TOOLS = new Set(['TodoWrite'])

export function categorizeHookEvent(
  event: AgentRunHookEventItem
): EventCategory {
  switch (event.type) {
    case 'POST_TOOL_USE_FAILURE':
      return 'tool_failure'
    case 'STOP':
      return 'turn_end'
    case 'STOP_FAILURE':
      return 'turn_failure'
    case 'USER_PROMPT_SUBMIT':
      return 'human_input'
    case 'PERMISSION_REQUEST':
      return 'permission_pause'
    case 'PERMISSION_DENIED':
      return 'permission_denied'
    case 'SESSION_START':
    case 'SESSION_END':
      return 'session_boundary'
    case 'SUBAGENT_START':
    case 'SUBAGENT_STOP':
      return 'subagent_boundary'
    case 'WORKTREE_CREATE':
    case 'WORKTREE_REMOVE':
      return 'worktree'
    case 'FILE_CHANGED':
      return 'file_changed'
    case 'CONFIG_CHANGE':
    case 'CWD_CHANGED':
      return 'config_change'
    case 'INSTRUCTIONS_LOADED':
    case 'PRE_COMPACT':
    case 'POST_COMPACT':
      return 'session_boundary'
    // LUM-1051: Codex ends an interrupted turn with INTERRUPT instead of STOP.
    case 'INTERRUPT':
      return 'turn_failure'
    case 'TASK_CREATED':
    case 'TASK_COMPLETED':
      return 'task_event'
    case 'NOTIFICATION':
      return 'notification'
    case 'ELICITATION':
    case 'ELICITATION_RESULT':
      return 'permission_pause'
    case 'USER_PROMPT_EXPANSION':
      return 'human_input'
    case 'PRE_TOOL_USE':
    case 'POST_TOOL_USE':
    case 'POST_TOOL_BATCH': {
      // PRE/POST split by toolName. POST is folded into the PRE row by the
      // Run-card view today; this categorizer covers the standalone PRE.
      const tool = event.toolName ?? ''
      if (READ_TOOLS.has(tool)) return 'tool_read'
      if (WRITE_TOOLS.has(tool)) return 'tool_write'
      if (EXEC_TOOLS.has(tool)) return 'tool_exec'
      if (PLAN_TOOLS.has(tool)) return 'tool_plan'
      return 'tool_other'
    }
    // Defense in depth: a HookEventType added to the Prisma enum before this
    // union/switch is updated must degrade to a neutral category, never crash
    // the timeline row (see __tests__/components/agentRunCategorize.test.ts).
    default:
      return 'tool_other'
  }
}

interface CategoryStyle {
  /** Tailwind classes for the leading dot. */
  dot: string
  /** Tailwind classes for the type pill text/border. */
  pill: string
}

export const CATEGORY_STYLE: Record<EventCategory, CategoryStyle> = {
  tool_read: {
    dot: 'bg-blue-500',
    pill: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40',
  },
  tool_write: {
    dot: 'bg-indigo-500',
    pill: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40',
  },
  tool_exec: {
    dot: 'bg-cyan-600',
    pill: 'text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/40',
  },
  tool_plan: {
    dot: 'bg-muted-foreground',
    pill: 'text-muted-foreground bg-muted',
  },
  tool_other: {
    dot: 'bg-blue-400',
    pill: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40',
  },
  tool_failure: {
    dot: 'bg-danger',
    pill: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
  },
  permission_pause: {
    dot: 'bg-warning-text',
    pill: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
  },
  permission_denied: {
    dot: 'bg-rose-600',
    pill: 'text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40',
  },
  human_input: {
    dot: 'bg-muted-foreground',
    pill: 'text-muted-foreground bg-muted',
  },
  turn_end: {
    dot: 'bg-muted-foreground',
    pill: 'text-muted-foreground bg-muted',
  },
  turn_failure: {
    dot: 'bg-danger',
    pill: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40',
  },
  session_boundary: {
    dot: 'bg-muted-foreground',
    pill: 'text-muted-foreground bg-muted',
  },
  subagent_boundary: {
    dot: 'bg-sky-500',
    pill: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40',
  },
  worktree: {
    dot: 'bg-emerald-500',
    pill: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
  },
  file_changed: {
    dot: 'bg-teal-500',
    pill: 'text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40',
  },
  config_change: {
    dot: 'bg-fuchsia-500',
    pill: 'text-fuchsia-700 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-950/40',
  },
  task_event: {
    dot: 'bg-green-600',
    pill: 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40',
  },
  notification: {
    dot: 'bg-violet-500',
    pill: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40',
  },
}

const PILL_LABEL: Record<AgentRunHookEventType, string> = {
  PRE_TOOL_USE: 'Tool',
  POST_TOOL_USE: 'Result',
  POST_TOOL_USE_FAILURE: 'Failed',
  STOP: 'Stop',
  STOP_FAILURE: 'StopFail',
  USER_PROMPT_SUBMIT: 'User',
  PERMISSION_REQUEST: 'Permission',
  PERMISSION_DENIED: 'Denied',
  SESSION_START: 'Session ▶',
  SESSION_END: 'Session ■',
  SUBAGENT_START: 'Subagent ▶',
  SUBAGENT_STOP: 'Subagent ■',
  WORKTREE_CREATE: 'Worktree +',
  WORKTREE_REMOVE: 'Worktree −',
  FILE_CHANGED: 'File',
  CONFIG_CHANGE: 'Config',
  TASK_CREATED: 'Task +',
  TASK_COMPLETED: 'Task ✓',
  POST_TOOL_BATCH: 'Batch',
  USER_PROMPT_EXPANSION: 'Expand',
  NOTIFICATION: 'Notify',
  ELICITATION: 'Elicit',
  ELICITATION_RESULT: 'Elicit ✓',
  CWD_CHANGED: 'CWD',
  INSTRUCTIONS_LOADED: 'Instructions',
  PRE_COMPACT: 'Compact ▶',
  POST_COMPACT: 'Compact ■',
  INTERRUPT: 'Interrupt',
}

export function pillLabel(event: AgentRunHookEventItem): string {
  if (
    event.type === 'PRE_TOOL_USE' ||
    event.type === 'POST_TOOL_USE' ||
    event.type === 'POST_TOOL_BATCH'
  ) {
    return event.toolName ?? PILL_LABEL[event.type] ?? event.type
  }
  // Fallback to the raw type for any value not yet in PILL_LABEL (enum drift).
  return PILL_LABEL[event.type] ?? event.type
}

/**
 * Extract a short summary string from the event payload for display.
 * `intl` is used for fallback strings when the payload lacks a usable
 * field — passed in so the function stays a pure helper instead of a
 * hook, while still respecting the user's locale.
 */
export function summarizeEvent(
  event: AgentRunHookEventItem,
  intl: IntlShape
): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const fb = (id: string, defaultMessage: string) =>
    intl.formatMessage({ id, defaultMessage })

  // LUM-859: the retention sweep left only a marker — say so instead of
  // falling through to a per-type fallback that reads as missing data.
  // LUM-944: a member deleted the session's raw record by hand.
  if (isUserDeletedPayload(event.payload))
    return fb('agentRun.event.deletedByUser', '原文已被删除')
  if (isPrunedPayload(event.payload))
    return fb('agentRun.event.prunedByRetention', '内容已按保留策略清除')

  switch (event.type) {
    case 'STOP': {
      const last = getString(payload, 'last_assistant_message')
      return last
        ? truncate(last, 160)
        : fb('agentRun.event.stopFallback', 'Agent 执行完成')
    }
    case 'STOP_FAILURE': {
      const err = getString(payload, 'error') ?? getString(payload, 'message')
      return err
        ? truncate(err, 160)
        : fb('agentRun.event.stopFailureFallback', '回合因 API 错误中止')
    }
    case 'USER_PROMPT_SUBMIT': {
      const prompt = getString(payload, 'prompt')
      return prompt
        ? truncate(prompt, 160)
        : fb('agentRun.event.userPromptFallback', '用户输入')
    }
    case 'PERMISSION_REQUEST': {
      const tool =
        getString(payload, 'tool_name') ?? getString(payload, 'toolName')
      const reason =
        getString(payload, 'reason') ??
        getString(payload, 'permission_reason') ??
        ''
      return (
        [tool && `${tool}`, reason && `→ ${reason}`]
          .filter(Boolean)
          .join(' ') ||
        fb('agentRun.event.permissionRequestFallback', '高风险操作 — 等待批准')
      )
    }
    case 'PERMISSION_DENIED': {
      const tool =
        getString(payload, 'tool_name') ?? getString(payload, 'toolName')
      const reason = getString(payload, 'reason') ?? ''
      return (
        [tool, reason && `→ ${reason}`].filter(Boolean).join(' ') ||
        fb('agentRun.event.permissionDeniedFallback', '被自动模式拦截')
      )
    }
    case 'SESSION_START': {
      const cwd = getString(payload, 'cwd')
      return cwd
        ? `cwd: ${cwd}`
        : fb('agentRun.event.sessionStartFallback', 'Agent session 开始')
    }
    case 'SESSION_END': {
      const reason = getString(payload, 'reason')
      return reason
        ? `${fb('agentRun.event.sessionEndPrefix', '结束')}: ${reason}`
        : fb('agentRun.event.sessionEndFallback', 'Agent session 结束')
    }
    case 'SUBAGENT_START': {
      const desc =
        getString(payload, 'description') ??
        getString(payload, 'subagent_type') ??
        ''
      return desc || fb('agentRun.event.subagentStartFallback', '子 agent 启动')
    }
    case 'SUBAGENT_STOP': {
      const result = getString(payload, 'result_summary')
      return result
        ? truncate(result, 160)
        : fb('agentRun.event.subagentStopFallback', '子 agent 完成')
    }
    case 'WORKTREE_CREATE': {
      const path = getString(payload, 'worktree_path') ?? ''
      const branch = getString(payload, 'branch')
      return (
        [path, branch && `(${branch})`].filter(Boolean).join(' ') ||
        fb('agentRun.event.worktreeCreateFallback', '创建 worktree')
      )
    }
    case 'WORKTREE_REMOVE': {
      const path = getString(payload, 'worktree_path') ?? ''
      return (
        path || fb('agentRun.event.worktreeRemoveFallback', '移除 worktree')
      )
    }
    case 'FILE_CHANGED': {
      const path =
        getString(payload, 'path') ?? getString(payload, 'file_path') ?? ''
      const change = getString(payload, 'change_type')
      return change
        ? `[${change}] ${path}`
        : path || fb('agentRun.event.fileChangedFallback', '文件变更')
    }
    case 'CONFIG_CHANGE': {
      const path =
        getString(payload, 'path') ?? getString(payload, 'file_path') ?? ''
      const scope = getString(payload, 'scope')
      return (
        [scope && `[${scope}]`, path].filter(Boolean).join(' ') ||
        fb('agentRun.event.configChangeFallback', '配置变更')
      )
    }
    case 'POST_TOOL_USE_FAILURE':
    case 'PRE_TOOL_USE':
    case 'POST_TOOL_USE':
    case 'POST_TOOL_BATCH': {
      const input = getRecord(payload, 'tool_input')
      const tool = event.toolName ?? ''
      return summarizeToolInput(tool, input)
    }
    case 'TASK_CREATED':
    case 'TASK_COMPLETED': {
      const id = getString(payload, 'identifier') ?? getString(payload, 'id')
      const title = getString(payload, 'title')
      return [id, title].filter(Boolean).join(' ')
    }
    case 'USER_PROMPT_EXPANSION': {
      const prompt = getString(payload, 'prompt')
      return prompt ? truncate(prompt, 160) : ''
    }
    case 'NOTIFICATION': {
      const message =
        getString(payload, 'message') ?? getString(payload, 'notification')
      return message ? truncate(message, 160) : ''
    }
    case 'ELICITATION': {
      const message =
        getString(payload, 'message') ?? getString(payload, 'prompt')
      return message ? truncate(message, 160) : ''
    }
    case 'ELICITATION_RESULT': {
      const result =
        getString(payload, 'response') ?? getString(payload, 'result')
      return result ? truncate(result, 160) : ''
    }
    case 'CWD_CHANGED': {
      const cwd = getString(payload, 'cwd') ?? getString(payload, 'path')
      return cwd ? `cwd: ${cwd}` : ''
    }
    case 'INSTRUCTIONS_LOADED': {
      const path =
        getString(payload, 'path') ?? getString(payload, 'source') ?? ''
      return path
    }
    case 'PRE_COMPACT':
    case 'POST_COMPACT': {
      const trigger = getString(payload, 'trigger')
      return trigger ? `[${trigger}]` : ''
    }
    // Unknown / future event types: no summary rather than a crash.
    default:
      return ''
  }
}

function summarizeToolInput(
  tool: string,
  input: Record<string, unknown> | null
): string {
  switch (tool) {
    case 'Bash': {
      const cmd = getString(input, 'command') ?? ''
      return truncate(cmd, 200)
    }
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return getString(input, 'file_path') ?? ''
    case 'NotebookEdit':
      return getString(input, 'notebook_path') ?? ''
    case APPLY_PATCH_TOOL:
      return parseApplyPatch(getString(input, 'command') ?? '')
        .files.map(f => f.moveTo ?? f.path)
        .join(', ')
    case 'WebFetch':
      return getString(input, 'url') ?? ''
    case 'Grep': {
      const pattern = getString(input, 'pattern') ?? ''
      const path = getString(input, 'path')
      return path ? `"${pattern}" in ${path}` : `"${pattern}"`
    }
    case 'Glob':
      return getString(input, 'pattern') ?? ''
    case 'Task': {
      const desc = getString(input, 'description') ?? ''
      const sub = getString(input, 'subagent_type')
      return sub ? `[${sub}] ${desc}` : desc
    }
    case 'TodoWrite': {
      const todos = getAny(input, 'todos')
      const n = Array.isArray(todos) ? todos.length : 0
      return `${n} items`
    }
    default: {
      if (!input) return ''
      return Object.keys(input).slice(0, 3).join(', ')
    }
  }
}

function truncate(s: string, max: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim()
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed
}

function getString(
  source: Record<string, unknown> | null,
  key: string
): string | null {
  if (!source) return null
  const v = source[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

function getRecord(
  source: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  if (!source) return null
  const v = source[key]
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  return null
}

function getAny(source: Record<string, unknown> | null, key: string): unknown {
  return source ? source[key] : undefined
}
