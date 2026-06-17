import {
  isIncompleteFact,
  isConstitutionRedundant,
  screenCandidate,
  CONSTITUTION_REDUNDANCY_FLOOR,
} from '@/lib/services/memory/extraction-gate'

describe('extraction gate — incomplete-fact screen (LUM-538)', () => {
  // The single criterion-5 guard: drops incomplete fragments AND keeps
  // terse-but-complete ones. Both directions, so the gate can't regress into
  // over-rejecting concise good memories.
  it('extraction gate rejects incomplete facts but keeps terse-complete fragments', () => {
    // ── DROP: bare-label fragments with no actionable claim ──
    const incomplete: Array<[Parameters<typeof isIncompleteFact>[0], unknown]> =
      [
        ['TRAP', { trigger: 'divergence', outcome: 'bug' }],
        // The canonical cryptic-log fragment: 4 words, no verb/proposition.
        ['TRAP', { trigger: 'taskId mismatch', outcome: 'payload divergence' }],
        ['CONVENTION', { rule: 'mismatch', scope: 'x' }],
        ['DECISION', { what: 'embedding drift', why: 'cosine' }],
        ['PROCEDURAL', { workflow: 'config', trigger: 'startup' }],
      ]
    for (const [category, content] of incomplete) {
      expect(isIncompleteFact(category, content)).toBe(true)
      expect(
        screenCandidate({ category, content, constitution: null })
      ).toEqual({ ok: false, reason: 'INCOMPLETE_FACT' })
    }

    // ── KEEP: terse but complete — carries an action / rule / cause→effect ──
    const complete: Array<[Parameters<typeof isIncompleteFact>[0], unknown]> = [
      ['CONVENTION', { rule: 'No console.log', scope: 'production code' }],
      ['CONVENTION', { rule: 'Use named exports', scope: 'all modules' }],
      [
        'TRAP',
        {
          trigger: 'Run prisma generate before tsc',
          outcome: 'else TaskArtifact is not exported',
        },
      ],
      [
        'TRAP',
        { trigger: 'P3012 on migrate', outcome: 'hand-write SQL → db execute' },
      ],
      [
        'DECISION',
        {
          what: 'Store HTML not JSON',
          why: 'two conversion paths drifted and corrupted docs',
        },
      ],
      [
        'PROCEDURAL',
        {
          workflow: 'Smoke-test headless browser fallback locally',
          trigger: 'verifying Chromium escalation',
        },
      ],
    ]
    for (const [category, content] of complete) {
      expect(isIncompleteFact(category, content)).toBe(false)
      expect(
        screenCandidate({ category, content, constitution: null })
      ).toEqual({ ok: true })
    }
  })

  it('treats a missing/empty headline as incomplete', () => {
    expect(
      isIncompleteFact('TRAP', { outcome: 'something happened here' })
    ).toBe(true)
    expect(isIncompleteFact('TRAP', null)).toBe(true)
    expect(isIncompleteFact('CONVENTION', { rule: '   ', scope: 'x' })).toBe(
      true
    )
  })
})

describe('extraction gate — constitution-redundancy pure check (LUM-538)', () => {
  const CONSTITUTION = [
    '# CLAUDE.md',
    '## Code Style',
    '- Use async/await, not .then()',
    '- No console.log in production code, use proper logging',
    '- Use Prisma for all database access — never raw SQL',
  ].join('\n')

  it('flags a near-verbatim restatement of a constitution rule', () => {
    expect(
      isConstitutionRedundant(
        'CONVENTION',
        {
          rule: 'Use Prisma for all database access, never raw SQL',
          scope: 'all database code',
        },
        CONSTITUTION
      )
    ).toBe(true)
  })

  it('does not flag a genuinely novel memory', () => {
    expect(
      isConstitutionRedundant(
        'TRAP',
        {
          trigger: 'Slack webhook retries exhaust after 3 attempts',
          outcome: 'notification silently dropped; add a dead-letter log',
        },
        CONSTITUTION
      )
    ).toBe(false)
  })

  it('fails open (keeps) when no constitution is available', () => {
    expect(
      isConstitutionRedundant(
        'CONVENTION',
        {
          rule: 'Use Prisma for all database access, never raw SQL',
          scope: 'db',
        },
        null
      )
    ).toBe(false)
  })

  it('redundancy floor sits above the unrelated-sentence band', () => {
    expect(CONSTITUTION_REDUNDANCY_FLOOR).toBeGreaterThan(0.45)
    expect(CONSTITUTION_REDUNDANCY_FLOOR).toBeLessThan(0.95)
  })
})
