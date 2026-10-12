/**
 * @jest-environment node
 *
 * LUM-932 P4: `lumo session status` lists task attribution and subagents;
 * an old server (no attribution fields) prints only the binding rows.
 * LUM-1090: rows are `Label:  value` padded to the widest label; attribution
 * and subagents are headed sections with aligned tables.
 */
jest.mock('../src/lib/session-id', () => ({
  ...jest.requireActual('../src/lib/session-id'),
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

it('prints only the binding rows when attribution is absent', async () => {
  expect(await run(root)).toBe(
    'Session sess-1\nBound to:  (no task)\nEvents:    7\n'
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
          // Stored turns are 0-based; the CLI prints them 1-based like the web.
          fromTurn: 0,
          toTurn: 3,
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
          fromTurn: 4,
          toTurn: 4,
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
  expect(out).toContain(
    '\nAttribution\n' +
      '  LUM-12  turns 1–4  auto-detected · high (git hint LUM-12, lumo cmd LUM-12)\n' +
      '  LUM-13  turn 5     auto-detected · medium (agent prompt LUM-13)\n'
  )
  expect(out).toContain(
    '\nSubagents\n' +
      '  Explore (123456)   LUM-14 subagent attach\n' +
      '  subagent (zzz999)  follows parent\n'
  )
  expect(out).toContain(
    '\n⚠ Some work was auto-detected — time and cost may be inaccurate. For exact numbers, run:\n' +
      '  lumo session attach <LUM-N>\n'
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
  expect(out).toContain('\nAttribution\n  None yet (no task signal)')
  expect(out).toContain('\n    lumo session attach <LUM-N>\n')
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
  expect(out.split('\n').slice(1, 3)).toEqual([
    'Subagent of:  sess-1',
    'Bound to:     (no task)',
  ])
})

it('tolerates an empty attribution payload', async () => {
  expect(await run({ ...root, attribution: {} })).toBe(
    'Session sess-1\nBound to:  (no task)\nEvents:    7\n'
  )
})

it('tolerates non-array segments and malformed evidence', async () => {
  const out = await run({
    ...root,
    attribution: { segments: 'nope', subagents: { a: 1 }, approximate: false },
  })
  expect(out).toBe('Session sess-1\nBound to:  (no task)\nEvents:    7\n')
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

it('prints the steward rows and no attribution even when it is present', async () => {
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
    'Session sess-1\nRole:      STEWARD (governance — plan & accept only)\nBound to:  milestone "M1"\nEvents:    7\n'
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

it('treats non-string confidence, identifiers and session ids as missing', async () => {
  const out = await run({
    ...root,
    attribution: {
      segments: [
        {
          taskIdentifier: null,
          source: 'INFERRED',
          confidence: 7,
          fromTurn: 0,
          toTurn: 0,
          evidence: [],
        },
      ],
      subagents: [
        {
          sessionId: 42,
          agentType: 'Explore',
          tasks: [
            { taskIdentifier: 3, source: 'SUBAGENT_ATTACH' },
            { taskIdentifier: 'LUM-9' },
          ],
        },
      ],
      unattributed: false,
      approximate: true,
    },
  })
  expect(out).toContain('\n  ?  turn 1  auto-detected\n')
  expect(out).toContain('\n  Explore ()  ? subagent attach, LUM-9 ?\n')
  expect(out).not.toContain('undefined')
})

it('groups subagents whose rendered line is identical into one counted line', async () => {
  const inherited = [
    { taskIdentifier: 'LUM-932', source: 'INHERITED', confidence: 'EXPLICIT' },
  ]
  const out = await run({
    ...root,
    attribution: {
      segments: [],
      subagents: [
        ...Array.from({ length: 120 }, (_, i) => ({
          sessionId: `sess-1:a${String(i).padStart(16, '0')}`,
          agentType: 'general-purpose',
          tasks: inherited,
        })),
        { sessionId: 'sess-1:abbbbbbccc111', agentType: 'Explore', tasks: [] },
        {
          sessionId: 'sess-1:accccccddd222',
          agentType: 'general-purpose',
          tasks: [],
        },
        {
          sessionId: 'sess-1:adddddd333333',
          agentType: 'general-purpose',
          tasks: [],
        },
      ],
      unattributed: false,
      approximate: false,
    },
  })
  const block = out.slice(out.indexOf('Subagents\n'))
  expect(block).toBe(
    'Subagents\n' +
      '  general-purpose ×120  LUM-932 inherited\n' +
      '  Explore (ccc111)      follows parent\n' +
      '  general-purpose ×2    follows parent\n'
  )
})
