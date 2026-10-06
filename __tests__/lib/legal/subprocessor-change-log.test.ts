/**
 * @jest-environment node
 *
 * LUM-919 — the subprocessor change log guard, the /security view of it and
 * the send script's notice-period check.
 */
import {
  buildSubprocessorPageView,
  checkSubprocessorChangeLog,
  daysUntilEffective,
  isPending,
  isUrgent,
  noticeDays,
  noticeRefusal,
  subprocessorFingerprint,
  subprocessorSubject,
  utcDayStart,
  type ChangeLogInput,
} from '@/lib/legal/subprocessor-change-log'
import {
  SUBPROCESSOR_BASELINE,
  SUBPROCESSOR_CHANGES,
  type SubprocessorChange,
} from '@/lib/legal/subprocessor-changes'
import {
  AI_HOST_SUBPROCESSORS,
  INFRASTRUCTURE_SUBPROCESSORS,
  type AiHostSubprocessor,
  type InfrastructureSubprocessor,
} from '@/lib/legal/subprocessors'

const REAL: ChangeLogInput = {
  baseline: SUBPROCESSOR_BASELINE,
  changes: SUBPROCESSOR_CHANGES,
  infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
  aiHosts: AI_HOST_SUBPROCESSORS,
}

const NEW_HOST: AiHostSubprocessor = {
  gatewaySlug: 'examplehost',
  entity: 'Example Host, Inc.',
  location: 'globalRouting',
}
const NEON = INFRASTRUCTURE_SUBPROCESSORS.find(s => s.id === 'neon')!
const NEON_EU: InfrastructureSubprocessor = {
  ...NEON,
  region: 'AWS eu-central-1',
}

function addHost(over: Partial<SubprocessorChange> = {}): SubprocessorChange {
  return {
    id: '2026-11-01-example-host',
    kind: 'added',
    announcedAt: '2026-11-01',
    effectiveAt: '2026-12-01',
    summary: 'Example Host, Inc. joins the AI model hosts.',
    after: { list: 'aiHost', entry: NEW_HOST },
    ...over,
  }
}

const withHost = (changes: SubprocessorChange[]): ChangeLogInput => ({
  ...REAL,
  changes,
  aiHosts: [...AI_HOST_SUBPROCESSORS, NEW_HOST],
})

describe('subprocessor change log guard (LUM-919)', () => {
  it('the shipped registry is in step with the shipped change log', () => {
    expect(checkSubprocessorChangeLog(REAL)).toEqual([])
  })

  it('fails for a registry entry added without a change record', () => {
    expect(checkSubprocessorChangeLog(withHost([]))).toEqual([
      'aiHost:examplehost: in the registry with no `added` record',
    ])
  })

  it('fails for an entry whose location changed without a change record', () => {
    const problems = checkSubprocessorChangeLog({
      ...REAL,
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS.map(s =>
        s.id === 'neon' ? NEON_EU : s
      ),
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^infrastructure:neon: registry differs/)
  })

  it('fails for an entry removed without a change record', () => {
    expect(
      checkSubprocessorChangeLog({
        ...REAL,
        aiHosts: AI_HOST_SUBPROCESSORS.filter(h => h.gatewaySlug !== 'wafer'),
      })
    ).toEqual(['aiHost:wafer: gone from the registry with no `removed` record'])
  })

  it('fails for an addition with under 30 days notice that is not urgent', () => {
    expect(
      checkSubprocessorChangeLog(
        withHost([addHost({ effectiveAt: '2026-11-30' })])
      )
    ).toEqual([
      '2026-11-01-example-host: 29 days of notice, DPA 7.2 needs 30 (or mark it urgent with a reason)',
    ])
  })

  it('passes an addition with 30 days notice, and an urgent one with a reason', () => {
    expect(checkSubprocessorChangeLog(withHost([addHost()]))).toEqual([])
    expect(
      checkSubprocessorChangeLog(
        withHost([
          addHost({
            effectiveAt: '2026-11-02',
            urgent: { reason: 'Current host lost its ZDR agreement.' },
          }),
        ])
      )
    ).toEqual([])
  })

  it('fails an urgent change with an empty reason', () => {
    expect(
      checkSubprocessorChangeLog(
        withHost([
          addHost({ effectiveAt: '2026-11-02', urgent: { reason: ' ' } }),
        ])
      )
    ).toEqual([
      '2026-11-01-example-host: urgent without a reason',
      '2026-11-01-example-host: 1 days of notice, DPA 7.2 needs 30 (or mark it urgent with a reason)',
    ])
  })

  it('a recorded removal needs no notice; a recorded change must match the state it replaces', () => {
    const wafer = AI_HOST_SUBPROCESSORS.find(h => h.gatewaySlug === 'wafer')!
    expect(
      checkSubprocessorChangeLog({
        ...REAL,
        changes: [
          {
            id: '2026-11-01-wafer-removed',
            kind: 'removed',
            announcedAt: '2026-11-01',
            effectiveAt: '2026-11-01',
            summary: 'Wafer no longer hosts Lumo models.',
            before: { list: 'aiHost', entry: wafer },
          },
        ],
        aiHosts: AI_HOST_SUBPROCESSORS.filter(h => h !== wafer),
      })
    ).toEqual([])

    const moved: SubprocessorChange = {
      id: '2026-11-01-neon-eu',
      kind: 'changed',
      announcedAt: '2026-11-01',
      effectiveAt: '2026-12-15',
      summary: 'Neon moves to AWS eu-central-1.',
      before: { list: 'infrastructure', entry: NEON_EU },
      after: { list: 'infrastructure', entry: NEON_EU },
    }
    const problems = checkSubprocessorChangeLog({
      ...REAL,
      changes: [moved],
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS.map(s =>
        s.id === 'neon' ? NEON_EU : s
      ),
    })
    expect(problems).toEqual([
      '2026-11-01-neon-eu: `before` does not match infrastructure:neon as logged',
    ])
  })

  it('names malformed records: id, dates, shape, order, duplicates', () => {
    const bad: SubprocessorChange[] = [
      addHost({ id: 'Example', announcedAt: '2026-12-02' }),
      addHost({ id: '2026-11-01-example-host', before: addHost().after! }),
      addHost({ id: '2026-11-01-example-host', effectiveAt: '2026-10-01' }),
    ]
    const problems = checkSubprocessorChangeLog(withHost(bad))
    expect(problems).toEqual(
      expect.arrayContaining([
        'Example: id is not YYYY-MM-DD-<slug>',
        '2026-11-01-example-host: out of order (the log is oldest first)',
        '2026-11-01-example-host: added needs `after` only',
        '2026-11-01-example-host: duplicate id',
        '2026-11-01-example-host: takes effect before it is announced',
      ])
    )
  })

  it('subject and fingerprint identify an entry by its facts', () => {
    expect(subprocessorSubject({ list: 'infrastructure', entry: NEON })).toBe(
      'infrastructure:neon'
    )
    expect(
      subprocessorFingerprint({ list: 'infrastructure', entry: NEON })
    ).toBe(SUBPROCESSOR_BASELINE['infrastructure:neon'])
    expect(subprocessorFingerprint({ list: 'aiHost', entry: NEW_HOST })).toBe(
      'Example Host, Inc. | globalRouting'
    )
  })

  it('date helpers count UTC calendar days', () => {
    expect(utcDayStart('2026-11-01')).toBe(Date.UTC(2026, 10, 1))
    expect(Number.isNaN(utcDayStart('1 Nov 2026'))).toBe(true)
    expect(noticeDays(addHost())).toBe(30)
    expect(isPending(addHost(), new Date('2026-11-30T23:59:59Z'))).toBe(true)
    expect(isPending(addHost(), new Date('2026-12-01T00:00:00Z'))).toBe(false)
    expect(
      daysUntilEffective(addHost(), new Date('2026-11-30T12:00:00Z'))
    ).toBe(0.5)
    expect(isUrgent(addHost())).toBe(false)
    expect(isUrgent(addHost({ urgent: { reason: 'Outage' } }))).toBe(true)
  })
})

describe('/security subprocessor view (LUM-919)', () => {
  const view = (changes: SubprocessorChange[], now: string) =>
    buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS.map(s =>
        s.id === 'neon' ? NEON_EU : s
      ),
      aiHosts: [...AI_HOST_SUBPROCESSORS, NEW_HOST],
      changes,
      now: new Date(now),
    })
  const move: SubprocessorChange = {
    id: '2026-11-01-neon-eu',
    kind: 'changed',
    announcedAt: '2026-11-01',
    effectiveAt: '2026-12-15',
    summary: 'Neon moves to AWS eu-central-1.',
    before: { list: 'infrastructure', entry: NEON },
    after: { list: 'infrastructure', entry: NEON_EU },
  }

  it('a pending addition is upcoming only and a pending move keeps the current location', () => {
    const v = view([addHost(), move], '2026-11-10T12:00:00Z')
    expect(v.aiHosts.map(h => h.gatewaySlug)).not.toContain('examplehost')
    expect(v.infrastructure.find(s => s.id === 'neon')).toEqual(NEON)
    expect(v.pending.map(c => c.id)).toEqual([
      '2026-11-01-example-host',
      '2026-11-01-neon-eu',
    ])
    expect(v.recent).toEqual([])
  })

  it('once in effect the change is in use and listed as recent, newest first', () => {
    const v = view([addHost(), move], '2026-12-20T00:00:00Z')
    expect(v.aiHosts.map(h => h.gatewaySlug)).toContain('examplehost')
    expect(v.infrastructure.find(s => s.id === 'neon')).toEqual(NEON_EU)
    expect(v.pending).toEqual([])
    expect(v.recent.map(c => c.id)).toEqual([
      '2026-11-01-neon-eu',
      '2026-11-01-example-host',
    ])
  })

  it('a pending move keeps the entry in its table position', () => {
    const v = view([move], '2026-11-10T12:00:00Z')
    expect(v.infrastructure.map(s => s.id)).toEqual(
      INFRASTRUCTURE_SUBPROCESSORS.map(s => s.id)
    )
  })

  it('unwinds two pending changes to one entry in log order, not effective order', () => {
    const NEON_EU2 = { ...NEON, region: 'AWS eu-west-1' }
    // Logged first, takes effect later; logged second, takes effect sooner.
    const first: SubprocessorChange = {
      ...move,
      id: '2026-11-01-neon-a',
      effectiveAt: '2027-01-15',
    }
    const second: SubprocessorChange = {
      ...move,
      id: '2026-11-02-neon-b',
      announcedAt: '2026-11-02',
      effectiveAt: '2026-12-20',
      before: { list: 'infrastructure', entry: NEON_EU },
      after: { list: 'infrastructure', entry: NEON_EU2 },
    }
    const v = buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS.map(s =>
        s.id === 'neon' ? NEON_EU2 : s
      ),
      aiHosts: AI_HOST_SUBPROCESSORS,
      changes: [first, second],
      now: new Date('2026-11-10T00:00:00Z'),
    })
    expect(v.infrastructure.find(s => s.id === 'neon')).toEqual(NEON)
  })

  it('a pending replacement shows the replaced host in the new host place, once', () => {
    const wafer = AI_HOST_SUBPROCESSORS.find(h => h.gatewaySlug === 'wafer')!
    const registry = AI_HOST_SUBPROCESSORS.map(h =>
      h === wafer ? NEW_HOST : h
    )
    const replace: SubprocessorChange = {
      id: '2026-11-01-wafer-replaced',
      kind: 'replaced',
      announcedAt: '2026-11-01',
      effectiveAt: '2026-12-01',
      summary: 'Example Host replaces Wafer.',
      before: { list: 'aiHost', entry: wafer },
      after: { list: 'aiHost', entry: NEW_HOST },
    }
    const v = buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
      aiHosts: registry,
      changes: [replace],
      now: new Date('2026-11-10T00:00:00Z'),
    })
    expect(v.aiHosts).toEqual(AI_HOST_SUBPROCESSORS)
    // A registry that still lists the replaced host never shows it twice.
    const stale = buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
      aiHosts: [...AI_HOST_SUBPROCESSORS, NEW_HOST],
      changes: [replace],
      now: new Date('2026-11-10T00:00:00Z'),
    })
    expect(stale.aiHosts).toEqual(AI_HOST_SUBPROCESSORS)
  })

  it('a pending removal stays in use until it takes effect', () => {
    const wafer = AI_HOST_SUBPROCESSORS.find(h => h.gatewaySlug === 'wafer')!
    const v = buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
      aiHosts: AI_HOST_SUBPROCESSORS.filter(h => h !== wafer),
      changes: [
        {
          id: '2026-11-01-wafer-removed',
          kind: 'removed',
          announcedAt: '2026-11-01',
          effectiveAt: '2026-11-15',
          summary: 'Wafer stops hosting Lumo models.',
          before: { list: 'aiHost', entry: wafer },
        },
      ],
      now: new Date('2026-11-10T00:00:00Z'),
    })
    expect(v.aiHosts.map(h => h.gatewaySlug)).toContain('wafer')
  })

  it('drops changes older than a year from the recent list', () => {
    expect(view([addHost()], '2027-12-02T00:00:00Z').recent).toEqual([])
  })

  it('with no changes it shows the registry as it is', () => {
    const v = buildSubprocessorPageView({
      infrastructure: INFRASTRUCTURE_SUBPROCESSORS,
      aiHosts: AI_HOST_SUBPROCESSORS,
      changes: [],
      now: new Date('2026-10-05T00:00:00Z'),
    })
    expect(v.infrastructure).toEqual(INFRASTRUCTURE_SUBPROCESSORS)
    expect(v.aiHosts).toEqual(AI_HOST_SUBPROCESSORS)
  })
})

describe('send notice-period check (LUM-919)', () => {
  it('refuses under 30 days unless urgent, and never sends a removal', () => {
    const now = new Date('2026-11-01T09:00:00Z')
    expect(noticeRefusal(addHost(), now)).toMatch(/29 days from now/)
    expect(noticeRefusal(addHost({ effectiveAt: '2026-12-02' }), now)).toBe(
      null
    )
    expect(noticeRefusal(addHost({ urgent: { reason: 'Outage' } }), now)).toBe(
      null
    )
    expect(
      noticeRefusal(
        addHost({ kind: 'removed', effectiveAt: '2026-12-31' }),
        now
      )
    ).toMatch(/removals are recorded, not announced/)
  })
})
