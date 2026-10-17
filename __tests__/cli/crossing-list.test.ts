/** @jest-environment node */
import {
  fetchActorNames,
  fetchCrossingRecords,
  normalizeCrossingRecord,
  sortCrossingRecords,
} from '@/cli/src/lib/crossing-records'
import {
  crossingFields,
  diffField,
  diffSideLines,
  DIFF_SIDE_LINES,
  formatCrossingList,
  oneLine,
} from '@/cli/src/commands/crossing-list'

const API = 'https://api.test'
const TOKEN = 'lum_x'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

afterEach(() => {
  jest.restoreAllMocks()
})

/** A dispositioned row as the LUM-435 endpoint returns it. */
const RULED = {
  id: 'cr1',
  ref: 'LUM-X7',
  category: 'DESTRUCTIVE_COMMAND',
  severity: 'MEDIUM',
  detail: 'rm -rf build',
  detectedAt: '2026-10-01T10:00:00.000Z',
  lastSeenAt: '2026-10-01T10:00:00.000Z',
  occurrenceCount: 1,
  reversible: true,
  disposition: 'FALSE_POSITIVE',
  dispositionNote: 'build output only',
  dispositionedAt: '2026-10-02T09:00:00.000Z',
  dispositionedById: 'actor-alice',
  dispositionChannel: 'CLI',
  lastDispositionChange: {
    from: 'CONFIRMED',
    to: 'FALSE_POSITIVE',
    actorId: 'actor-alice',
    at: '2026-10-02T09:00:00.000Z',
    channel: 'CLI',
  },
  remediationTask: {
    identifier: 'LUM-88',
    title: 'Fix cleanup script',
    status: 'DONE',
    remediated: true,
  },
  editChange: null,
  attribution: {
    model: 'claude-x',
    agent: 'CLAUDE_CODE',
    sessionId: 'abcdef1234',
  },
  explanations: [],
  advisory: false,
  rejudge: null,
  policyRuleRef: null,
  policyRuleText: null,
  agentContext: null,
  systemExplanation: null,
  triageProbability: null,
  triageModel: null,
  rawPurged: false,
  suppressionRule: {
    id: 'rule12345678',
    reason: 'generated dir',
    revokedAt: '2026-10-03T00:00:00.000Z',
  },
}

/** An open row carrying the panel's details. */
const OPEN = {
  id: 'cr2',
  ref: 'LUM-X8',
  category: 'TEST_TAMPERING',
  severity: 'HIGH',
  detail: 'removed assertion in a.test.ts',
  detectedAt: '2026-10-04T10:00:00.000Z',
  lastSeenAt: '2026-10-05T11:00:00.000Z',
  occurrenceCount: 3,
  reversible: false,
  disposition: null,
  dispositionNote: null,
  dispositionedAt: null,
  dispositionedById: null,
  dispositionChannel: null,
  lastDispositionChange: null,
  remediationTask: null,
  editChange: {
    kind: 'edit',
    oldText: 'expect(a).toBe(1)',
    newText: '// removed',
    truncated: false,
    unavailable: null,
    prUrl: 'https://github.com/o/r/pull/1',
    prFileUrl: 'https://github.com/o/r/pull/1/files#diff-abc',
    agentTurnContext: 'Fix flaky test',
  },
  attribution: {},
  explanations: [{ note: 'the assertion was obsolete' }],
  advisory: false,
  rejudge: null,
  policyRuleRef: 'R3',
  policyRuleText: 'Never weaken an assertion',
  agentContext: null,
  systemExplanation: null,
  triageProbability: 0.25,
  triageModel: 'm1',
  rawPurged: false,
  suppressionRule: null,
}

describe('normalizeCrossingRecord', () => {
  it('keeps the dispositioned fields and computes blocking for open rows only', () => {
    const ruled = normalizeCrossingRecord(RULED, true)
    expect(ruled.disposition).toBe('FALSE_POSITIVE')
    expect(ruled.dispositionedById).toBe('actor-alice')
    expect(ruled.dispositionChannel).toBe('CLI')
    expect(ruled.lastDispositionChange?.from).toBe('CONFIRMED')
    expect(ruled.blocking).toBe(false)
    const open = normalizeCrossingRecord(OPEN, true)
    expect(open.blocking).toBe(true)
    expect(open.explanations).toEqual(['the assertion was obsolete'])
  })

  it('reads fields absent from an older server as null, never fabricated', () => {
    const r = normalizeCrossingRecord(
      {
        id: 'x',
        category: 'C',
        severity: 'BOGUS',
        detail: 'd',
        disposition: null,
      },
      true
    )
    expect(r.ref).toBe('x')
    expect(r.severity).toBe('LOW')
    expect(r.occurrenceCount).toBeNull()
    expect(r.reversible).toBeNull()
    expect(r.policyRuleText).toBeNull()
    expect(r.editChange).toBeNull()
    expect(r.remediationTask).toBeNull()
  })
})

describe('sortCrossingRecords', () => {
  it('puts open rows first, then the history most recently ruled first', () => {
    const older = {
      ...RULED,
      id: 'old',
      dispositionedAt: '2026-09-01T00:00:00.000Z',
    }
    const rows = [RULED, older, OPEN].map(r => normalizeCrossingRecord(r, true))
    expect(sortCrossingRecords(rows).map(r => r.id)).toEqual([
      'cr2',
      'cr1',
      'old',
    ])
  })
})

describe('fetchCrossingRecords (LUM-1187)', () => {
  it('returns open AND dispositioned rows — no disposition filter', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { crossings: [RULED, OPEN], gateEnabled: true })
      )
    const result = await fetchCrossingRecords(API, TOKEN, 'LUM-9')
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.crossings.map(c => c.id)).toEqual(['cr2', 'cr1'])
    expect(result.raw).toHaveLength(2)
  })

  it('maps 404 / 401 / HTTP error / transport failure to distinct statuses', async () => {
    const spy = jest.spyOn(global, 'fetch')
    spy.mockResolvedValueOnce(jsonResponse(404, {}))
    expect((await fetchCrossingRecords(API, TOKEN, 'LUM-9')).status).toBe(
      'not_found'
    )
    spy.mockResolvedValueOnce(jsonResponse(401, {}))
    expect((await fetchCrossingRecords(API, TOKEN, 'LUM-9')).status).toBe(
      'unauthorized'
    )
    spy.mockResolvedValueOnce(jsonResponse(500, {}))
    expect(await fetchCrossingRecords(API, TOKEN, 'LUM-9')).toEqual({
      status: 'error',
      reason: 'HTTP 500',
    })
    spy.mockRejectedValueOnce(new Error('boom'))
    expect(await fetchCrossingRecords(API, TOKEN, 'LUM-9')).toEqual({
      status: 'error',
      reason: 'boom',
    })
  })
})

describe('fetchActorNames', () => {
  it('maps member and agent actor ids to names', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        members: [{ id: 'm1', actorId: 'actor-alice', name: 'Alice' }],
        agentActors: [{ actorId: 'actor-bot', name: 'Agent' }],
      })
    )
    const names = await fetchActorNames(API, TOKEN)
    expect(names.get('actor-alice')).toBe('Alice')
    expect(names.get('actor-bot')).toBe('Agent')
  })

  it('degrades to an empty map on failure', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('down'))
    expect((await fetchActorNames(API, TOKEN)).size).toBe(0)
  })
})

describe('formatCrossingList — dispositioned history (--all)', () => {
  const rows = [RULED, OPEN].map(r => normalizeCrossingRecord(r, true))

  it('prints who ruled, the note, the channel and the from → to correction', () => {
    const out = formatCrossingList('LUM-9', rows, {
      all: true,
      actorNames: new Map([['actor-alice', 'Alice']]),
    })
    expect(out).toContain('LUM-X7 [MEDIUM] DESTRUCTIVE_COMMAND')
    expect(out).toMatch(/State:\s+FALSE_POSITIVE/)
    // LUM-1230: the name only — the actor id never reaches prose output.
    expect(out).toMatch(/Ruled by:\s+Alice\n/)
    expect(out).not.toContain('actor-alice')
    expect(out).toMatch(/Note:\s+build output only/)
    expect(out).toMatch(/Channel:\s+CLI/)
    expect(out).toContain('CONFIRMED → FALSE_POSITIVE by Alice at')
    expect(out).toContain('revoked 2026-10-03T00:00:00.000Z')
    expect(out).toContain('LUM-88 Fix cleanup script (DONE, remediated)')
  })

  it('says "unknown member" (not the actor id) when the name is unknown', () => {
    const out = formatCrossingList('LUM-9', rows, { all: true })
    expect(out).toMatch(/Ruled by:\s+unknown member/)
    expect(out).not.toContain('actor-alice')
  })

  it('LUM-1230: a real ruler uuid never reaches the prose (production case)', () => {
    const uuid = '7129f67e-232f-4171-b02b-f5bece6ec12e'
    const ruled = normalizeCrossingRecord(
      {
        ...RULED,
        dispositionedById: uuid,
        lastDispositionChange: {
          ...RULED.lastDispositionChange,
          actorId: uuid,
        },
      },
      true
    )
    const out = formatCrossingList('LUM-9', [ruled], {
      all: true,
      actorNames: new Map([[uuid, 'Chao Li']]),
    })
    expect(out).toMatch(/Ruled by:\s+Chao Li\n/)
    expect(out).not.toContain(uuid)
  })

  it('hides dispositioned rows without --all and says how many', () => {
    const out = formatCrossingList('LUM-9', rows, {})
    expect(out).not.toContain('LUM-X7')
    expect(out).toContain('1 open (1 blocking DONE), 1 dispositioned')
    expect(out).toContain('1 dispositioned crossing(s) not shown')
  })

  it('says so when there is nothing to show', () => {
    expect(formatCrossingList('LUM-9', [], {})).toContain('No open crossings.')
    expect(formatCrossingList('LUM-9', [], { all: true })).toContain(
      'No crossings recorded.'
    )
  })
})

describe('formatCrossingList — open-row details', () => {
  it('shows the diff summary, recurrence and the rule text', () => {
    const out = formatCrossingList('LUM-9', [
      normalizeCrossingRecord(OPEN, true),
    ])
    expect(out).toMatch(/State:\s+OPEN · blocks DONE/)
    expect(out).toMatch(
      /Occurrences:\s+×3 · last seen 2026-10-05T11:00:00.000Z/
    )
    expect(out).toMatch(/Rule:\s+\[R3\] Never weaken an assertion/)
    expect(out).toContain('- expect(a).toBe(1)')
    expect(out).toContain('+ // removed')
    expect(out).toContain('PR: https://github.com/o/r/pull/1/files#diff-abc')
    expect(out).toMatch(/Turn intent:\s+Fix flaky test/)
    expect(out).toMatch(/AI triage:\s+P\(legit\)=0.25 \(m1\)/)
    expect(out).toContain('• the assertion was obsolete')
    expect(out).toContain(
      'lumo crossing disposition <ref> --false-positive | --confirmed'
    )
  })

  it("prints '-' for every field the response does not carry", () => {
    const bare = normalizeCrossingRecord(
      {
        id: 'x',
        ref: 'LUM-X1',
        category: 'C',
        severity: 'LOW',
        detail: 'd',
        disposition: null,
      },
      true
    )
    const byLabel = new Map(crossingFields(bare).map(f => [f.label, f.value]))
    for (const label of [
      'Occurrences',
      'Reversible',
      'Rule',
      'Diff',
      'Turn intent',
      'System explanation',
      'Agent explanations',
      'Re-judge',
      'AI triage',
      'Remediation',
      'Detected',
    ])
      expect(byLabel.get(label)).toBe('-')
  })
})

describe('untrusted text is sanitized (ANSI / control characters)', () => {
  const ESC = '\u001b'
  const CSI8 = '\u009b'
  const evil = {
    ...RULED,
    ref: `LUM-X9${ESC}[2J`,
    category: `CAT${ESC}]0;title\u0007`,
    detail: `ok${ESC}[31mRED${ESC}[0m\nState:  FALSE_POSITIVE\r${CSI8}31m`,
    dispositionNote: `note${ESC}[1A\u0000`,
    policyRuleText: `rule${ESC}[5m`,
    systemExplanation: `sys${ESC}c`,
    explanations: [{ note: `self${ESC}[2K` }],
    remediationTask: {
      identifier: 'LUM-1',
      title: `t${ESC}[8m`,
      status: 'TODO',
      remediated: false,
    },
    editChange: {
      kind: 'edit',
      oldText: `old${ESC}[31m\u0007`,
      newText: `new${CSI8}2J`,
      truncated: true,
      unavailable: null,
      prUrl: null,
      prFileUrl: null,
      agentTurnContext: null,
    },
  }

  it('emits no ESC, CSI, BEL or NUL and cannot forge a row via a newline', () => {
    const out = formatCrossingList(
      'LUM-9',
      [normalizeCrossingRecord(evil, true)],
      {
        all: true,
        actorNames: new Map([['actor-alice', `Al${ESC}[31mice`]]),
      }
    )

    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/)
    expect(out).toContain('ok[31mRED[0m State: FALSE_POSITIVE31m')
    expect(out).toContain('- old[31m')
    expect(out).toContain('+ new2J')
    expect(out).toContain('(content was truncated for display)')
    // The injected "State:" stays inside the Detail value — only one State row.
    expect(out.match(/^\s+State:/gm)).toHaveLength(1)
  })
})

describe('layout', () => {
  it('wraps long agent explanations inside the report width', () => {
    const long = { ...OPEN, explanations: [{ note: 'word '.repeat(60) }] }
    const out = formatCrossingList('LUM-9', [
      normalizeCrossingRecord(long, true),
    ])
    for (const line of out.split('\n'))
      expect(line.length).toBeLessThanOrEqual(100)
    expect(out).toContain('    • word word')
  })
})

describe('helpers', () => {
  it('oneLine strips control characters and collapses whitespace', () => {
    expect(oneLine('a\u001b[1m\n\tb  c')).toBe('a[1m b c')
    expect(oneLine(null)).toBe('')
  })

  it('diffSideLines caps each side and reports the elided count', () => {
    const text = Array.from(
      { length: DIFF_SIDE_LINES + 3 },
      (_, i) => `l${i}`
    ).join('\n')
    const lines = diffSideLines(text, '+')
    expect(lines).toHaveLength(DIFF_SIDE_LINES + 1)
    expect(lines[lines.length - 1]).toBe('+ … (3 more line(s))')
  })

  it('diffField reports an unavailable edit with its reason and PR link', () => {
    const f = diffField({
      kind: null,
      oldText: null,
      newText: null,
      truncated: false,
      unavailable: 'EVENT_MISSING',
      prUrl: 'https://github.com/o/r/pull/2',
      prFileUrl: null,
      agentTurnContext: null,
    })
    expect(f.value).toBe('unavailable (EVENT_MISSING)')
    expect(f.sub).toEqual(['PR: https://github.com/o/r/pull/2'])
    expect(diffField(null).value).toBe('-')
  })
})
