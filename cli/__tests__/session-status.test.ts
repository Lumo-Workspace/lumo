/**
 * @jest-environment node
 *
 * LUM-932 P4: `lumo session status` lists task attribution and subagents;
 * an old server (no attribution fields) prints exactly what it always did.
 */
jest.mock('../src/lib/session-id', () => ({
  resolveSessionId: async () => 'sess-1',
}))
jest.mock('../src/lib/config', () => ({
  readCredentials: () => ({ token: 't', apiUrl: 'https://lumo.test' }),
}))

import { sessionStatus } from '../src/commands/session-status'

const realFetch = global.fetch
afterAll(() => {
  global.fetch = realFetch
})

async function run(body: Record<string, unknown>): Promise<string> {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch
  let out = ''
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((
    s: string
  ) => {
    out += s
    return true
  }) as never)
  try {
    await sessionStatus()
  } finally {
    spy.mockRestore()
  }
  return out
}

const root = {
  exists: true,
  sessionId: 'sess-1',
  eventCount: 7,
  taskIdentifier: null,
  taskTitle: null,
}

it('prints today output when attribution is absent', async () => {
  expect(await run(root)).toBe(
    'Session sess-1\n  Bound to:  (no task)\n  Events:    7\n'
  )
})

it('prints segments, evidence, subagents and the approximate warning', async () => {
  const out = await run({
    ...root,
    attribution: {
      segments: [
        {
          taskIdentifier: 'LUM-12',
          source: 'INFERRED',
          confidence: 'HIGH',
          fromTurn: 1,
          toTurn: 4,
          evidence: [
            { kind: 'GIT_HINT', identifier: 'LUM-12', at: 'x' },
            { kind: 'GIT_HINT', identifier: 'LUM-12', at: 'y' },
            { kind: 'LUMO_CMD', identifier: 'LUM-12', at: 'z' },
          ],
        },
        {
          taskIdentifier: 'LUM-13',
          source: 'INFERRED',
          confidence: 'MEDIUM',
          fromTurn: 5,
          toTurn: 5,
          evidence: [{ kind: 'AGENT_PROMPT', identifier: 'LUM-13', at: 'x' }],
        },
      ],
      subagents: [
        {
          sessionId: 'sess-1:aaaabcdef123456',
          agentType: 'Explore',
          tasks: [
            {
              taskIdentifier: 'LUM-14',
              source: 'SUBAGENT_ATTACH',
              confidence: 'EXPLICIT',
            },
          ],
        },
        { sessionId: 'sess-1:zzz999', agentType: null, tasks: [] },
      ],
      unattributed: false,
      approximate: true,
    },
  })
  expect(out).toContain('  Attribution:\n')
  expect(out).toContain(
    '    LUM-12  turns 1–4  auto-detected · high (git hint LUM-12, lumo cmd LUM-12)\n'
  )
  expect(out).toContain(
    '    LUM-13  turn 5  auto-detected · medium (agent prompt LUM-13)\n'
  )
  expect(out).toContain('  Subagents:\n')
  expect(out).toContain('    Explore (123456)  LUM-14 subagent attach\n')
  expect(out).toContain('    subagent (zzz999)  follows parent\n')
  expect(out).toContain(
    '  ⚠ Some work was auto-detected — time and cost may be inaccurate. Run `lumo session attach <LUM-N>` for exact numbers.\n'
  )
})

it('prints the none-yet line for an unattributed, unbound session', async () => {
  const out = await run({
    ...root,
    attribution: {
      segments: [],
      subagents: [],
      unattributed: true,
      approximate: false,
    },
  })
  expect(out).toContain('  Attribution: none yet (no task signal)')
  expect(out).not.toContain('⚠')
})

it('prints Subagent of for a child session', async () => {
  const out = await run({
    ...root,
    sessionId: 'sess-1:a1',
    parentSessionId: 'sess-1',
    attribution: {
      segments: [],
      subagents: [],
      unattributed: false,
      approximate: false,
    },
  })
  expect(out.split('\n')[1]).toBe('  Subagent of: sess-1')
})

it('tolerates an empty attribution payload', async () => {
  expect(await run({ ...root, attribution: {} })).toBe(
    'Session sess-1\n  Bound to:  (no task)\n  Events:    7\n'
  )
})

it('tolerates non-array segments and malformed evidence', async () => {
  const out = await run({
    ...root,
    attribution: { segments: 'nope', subagents: { a: 1 }, approximate: false },
  })
  expect(out).toBe('Session sess-1\n  Bound to:  (no task)\n  Events:    7\n')
  const out2 = await run({
    ...root,
    attribution: {
      segments: [
        {
          taskIdentifier: 'LUM-1',
          source: 'INFERRED',
          confidence: 'HIGH',
          fromTurn: 1,
          toTurn: 1,
          evidence: [
            { kind: 5, identifier: null },
            { kind: 'GIT_HINT', identifier: 'LUM-1' },
          ],
        },
      ],
    },
  })
  expect(out2).toContain('(git hint LUM-1)')
})

it('keeps steward output exactly as today even with attribution', async () => {
  const out = await run({
    ...root,
    role: 'STEWARD',
    milestoneName: 'M1',
    attribution: {
      segments: [],
      subagents: [],
      unattributed: true,
      approximate: true,
    },
  })
  expect(out).toBe(
    'Session sess-1\n  Role:      STEWARD (governance — plan & accept only)\n  Bound to:  milestone "M1"\n  Events:    7\n'
  )
})

it('omits the none-yet line for a bound session', async () => {
  const out = await run({
    ...root,
    taskIdentifier: 'LUM-1',
    taskTitle: 'T',
    attribution: {
      segments: [],
      subagents: [],
      unattributed: true,
      approximate: false,
    },
  })
  expect(out).not.toContain('none yet')
})
