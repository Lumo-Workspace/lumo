/**
 * LUM-1188 — one Agent Run timeline (the /agent-runs wire shape) shared by the
 * report-service test, the CLI formatter test and the web-parity test, so the
 * CLI numbers are checked against the web card on the SAME input.
 */
import type {
  AgentRunSession,
  AgentRunTimelineResult,
} from '@/lib/services/agent-run-timeline.service'

const hook = (
  id: string,
  type: string,
  createdAt: string,
  turnSummary: string | null = null
) => ({
  id,
  kind: 'hook' as const,
  type: type as never,
  toolName: type === 'PRE_TOOL_USE' ? 'Bash' : null,
  payload: { secret_payload: 'never-leaves-the-server' },
  turnSummary,
  turnCost: null,
  createdAt,
})

/** Bound run, newer, two models, a summary and an injected memory. */
export const RUN_BOUND: AgentRunSession = {
  sessionId: 'sess-bound-0000000001',
  agent: 'CLAUDE_CODE',
  runNumber: 2,
  startedAt: '2026-10-10T09:00:00.000Z',
  lastActivityAt: '2026-10-10T10:00:00.000Z',
  durationMs: 2_520_000,
  toolCallCount: 3,
  eventCount: 7,
  memoryCount: 1,
  runSummary: 'Moved the agent-runs routes to bearer auth.',
  cost: {
    byModel: [
      {
        model: 'claude-opus-4',
        input: 1000,
        output: 2000,
        cacheRead: 400_000,
        cacheCreation: 50_000,
        total: 453_000,
      },
      {
        model: 'claude-sonnet-4',
        input: 100,
        output: 200,
        cacheRead: 30_000,
        cacheCreation: 4_700,
        total: 35_000,
      },
    ],
    loopCount: 4,
  },
  member: { workspaceMemberId: 'm-1', name: 'Chao Li', imageUrl: '' },
  attribution: {
    mode: 'EXPLICIT',
    segments: [],
    subagents: [
      {
        sessionId: 'sess-bound-0000000001:a1',
        agentType: 'Explore',
        source: 'INFERRED',
        confidence: 'HIGH',
        evidence: [
          {
            kind: 'AGENT_PROMPT',
            identifier: 'LUM-1188',
            at: '2026-10-10T09:10:00.000Z',
          },
        ],
        followsParent: false,
      },
      {
        sessionId: 'sess-bound-0000000001:a2',
        agentType: 'Explore',
        source: 'INFERRED',
        confidence: 'HIGH',
        evidence: [
          {
            kind: 'AGENT_PROMPT',
            identifier: 'LUM-1188',
            at: '2026-10-10T09:20:00.000Z',
          },
        ],
        followsParent: false,
      },
    ],
    approximate: true,
  },
  usageResyncedAt: null,
  items: [
    hook('e1', 'USER_PROMPT_SUBMIT', '2026-10-10T09:00:00.000Z'),
    hook('e2', 'PRE_TOOL_USE', '2026-10-10T09:01:00.000Z'),
    hook('e3', 'STOP', '2026-10-10T09:05:00.000Z', 'first turn'),
    {
      id: 'mem-1',
      kind: 'memory',
      category: 'TRAP',
      agent: 'CLAUDE_CODE',
      content: {
        trigger: 'Calling requireAuth on a CLI-read route',
        outcome: 'the CLI gets 401',
      },
      createdAt: '2026-10-10T09:06:00.000Z',
    },
    hook('e4', 'USER_PROMPT_SUBMIT', '2026-10-10T09:30:00.000Z'),
    hook('e5', 'PRE_TOOL_USE', '2026-10-10T09:31:00.000Z'),
    hook('e6', 'STOP', '2026-10-10T09:40:00.000Z', 'second turn'),
    hook('e7', 'PRE_TOOL_USE', '2026-10-10T09:50:00.000Z'),
  ],
}

/** Auto-detected run, older (pre-dedupe), no summary → digest, medium confidence. */
export const RUN_INFERRED: AgentRunSession = {
  sessionId: 'sess-infer-0000000002',
  agent: 'CODEX',
  runNumber: 1,
  startedAt: '2026-09-20T09:00:00.000Z',
  lastActivityAt: '2026-09-20T09:30:00.000Z',
  durationMs: 600_000,
  toolCallCount: 1,
  eventCount: 3,
  memoryCount: 0,
  runSummary: null,
  cost: {
    byModel: [
      {
        model: 'gpt-5',
        input: 10_000,
        output: 2_000,
        cacheRead: 0,
        cacheCreation: 0,
        total: 12_000,
      },
    ],
    loopCount: 1,
  },
  member: { workspaceMemberId: 'm-2', name: 'Pat', imageUrl: '' },
  attribution: {
    mode: 'INFERRED',
    segments: [
      {
        source: 'INFERRED',
        confidence: 'MEDIUM',
        fromTurn: 0,
        toTurn: 0,
        fromAt: '2026-09-20T09:00:00.000Z',
        toAt: null,
        evidence: [
          {
            kind: 'BRANCH',
            identifier: 'lumo/LUM-1188-x',
            at: '2026-09-20T09:00:00.000Z',
          },
          {
            kind: 'BRANCH',
            identifier: 'lumo/LUM-1188-x',
            at: '2026-09-20T09:05:00.000Z',
          },
        ],
      },
    ],
    subagents: [],
    approximate: true,
  },
  usageResyncedAt: null,
  items: [
    hook('f1', 'USER_PROMPT_SUBMIT', '2026-09-20T09:00:00.000Z'),
    hook('f2', 'PRE_TOOL_USE', '2026-09-20T09:01:00.000Z'),
    hook('f3', 'STOP', '2026-09-20T09:10:00.000Z', 'checked the routes'),
  ],
}

export const TIMELINE: AgentRunTimelineResult = {
  runs: [RUN_BOUND, RUN_INFERRED],
  totals: {
    runCount: 2,
    loopCount: 5,
    byModel: [
      { ...RUN_BOUND.cost!.byModel[0]! },
      { ...RUN_BOUND.cost!.byModel[1]! },
      { ...RUN_INFERRED.cost!.byModel[0]! },
    ],
  },
  perMember: [
    {
      workspaceMemberId: 'm-1',
      clerkId: null,
      name: 'Chao Li',
      imageUrl: '',
      runCount: 1,
      loopCount: 4,
      byModel: RUN_BOUND.cost!.byModel,
    },
    {
      workspaceMemberId: 'm-2',
      clerkId: null,
      name: 'Pat',
      imageUrl: '',
      runCount: 1,
      loopCount: 1,
      byModel: RUN_INFERRED.cost!.byModel,
    },
  ],
}
