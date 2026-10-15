/**
 * @jest-environment node
 *
 * LUM-1155 — the call-flow sequence diagram in the walkthrough. PURE parts:
 * the model's answer is cleaned (redacted, reduced to an inert character
 * set, bounded), Lumo renders the Mermaid itself, and the source is checked
 * before posting. The rendered source is parsed with the REAL Mermaid
 * parser (in a child Node process — mermaid is ESM-only and cannot load in
 * jest), hostile labels included.
 */
import { execFileSync } from 'child_process'
import { join } from 'path'
import {
  cleanSequenceDiagram,
  diagramLabel,
  isFlowFile,
  isValidSequenceDiagramSource,
  parseSequenceDiagram,
  renderSequenceDiagram,
  sequenceDiagramEligible,
  sequenceDiagramSection,
  SEQUENCE_DIAGRAM_MAX_PARTICIPANTS,
  SEQUENCE_DIAGRAM_MAX_STEPS,
  SEQUENCE_DIAGRAM_MESSAGE_MAX_CHARS,
} from '@/ee/security/security-scan/sequence-diagram'
import { buildWalkthrough } from '@/ee/security/security-scan/pr-walkthrough'

// Built from parts so the fixture itself is not a key-shaped literal.
const KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')

/** Parse each source with the real Mermaid parser. */
function mermaidParse(
  sources: string[]
): Array<{ ok: boolean; type?: string | null; error?: string }> {
  const out = execFileSync(
    process.execPath,
    [join(process.cwd(), 'test-utils', 'mermaid-parse.mjs')],
    { input: JSON.stringify(sources), encoding: 'utf8', timeout: 60_000 }
  )
  return JSON.parse(out)
}

const FLOW = {
  participants: ['Web UI', 'API route', 'Review service', 'GitHub'],
  steps: [
    { from: 'Web UI', to: 'API route', message: 'POST settings' },
    { from: 'API route', to: 'Review service', message: 'update(repo)' },
    { from: 'Review service', to: 'GitHub', message: 'fetch PR diff' },
    {
      from: 'Review service',
      to: 'API route',
      message: 'saved',
      reply: true,
    },
  ],
}

/** Labels that are Mermaid syntax, markup or secrets. */
const HOSTILE = [
  'end',
  'participant',
  'loop',
  'alt x',
  'else',
  'Note over P1',
  'A->>B: injected',
  'x;y#59;z',
  '%%{init: {"theme":"dark"}}%%',
  'a:b',
  '<script>alert(1)</script>',
  '<br/>line',
  '[link](https://evil.example)',
  '@someone ping',
  '<!-- lumo-security:fp -->',
  'x--x',
  'a--)b',
  '+activate',
  '-deactivate',
  `token ${KEY}`,
  'autonumber',
  'create participant Z',
  'destroy P2',
  'title Owned',
  'Über 日本語 ok',
  "it's (fine) & done?",
  '`code`',
  'line\nbreak',
]

describe('cleanSequenceDiagram', () => {
  it('maps participant names to indexes and keeps the order of calls', () => {
    const d = cleanSequenceDiagram(FLOW)!
    expect(d.participants).toEqual([
      'Web UI',
      'API route',
      'Review service',
      'GitHub',
    ])
    expect(d.steps).toEqual([
      { from: 0, to: 1, message: 'POST settings', reply: false },
      { from: 1, to: 2, message: 'update(repo)', reply: false },
      { from: 2, to: 3, message: 'fetch PR diff', reply: false },
      { from: 2, to: 1, message: 'saved', reply: true },
    ])
  })

  it('drops calls naming an unknown participant and participants no call names', () => {
    const d = cleanSequenceDiagram({
      participants: ['A', 'B', 'Unused'],
      steps: [
        { from: 'A', to: 'B', message: 'one' },
        { from: 'A', to: 'Nobody', message: 'lost' },
        { from: 'B', to: 'A', message: 'two', reply: true },
      ],
    })!
    expect(d.participants).toEqual(['A', 'B'])
    expect(d.steps.map(s => s.message)).toEqual(['one', 'two'])
  })

  it('is null when there is no flow worth drawing', () => {
    expect(cleanSequenceDiagram(null)).toBeNull()
    expect(cleanSequenceDiagram('sequenceDiagram')).toBeNull()
    expect(cleanSequenceDiagram({ participants: ['A'], steps: [] })).toBeNull()
    // One call only.
    expect(
      cleanSequenceDiagram({
        participants: ['A', 'B'],
        steps: [{ from: 'A', to: 'B', message: 'x' }],
      })
    ).toBeNull()
    // Only self-calls.
    expect(
      cleanSequenceDiagram({
        participants: ['A', 'B'],
        steps: [
          { from: 'A', to: 'A', message: 'x' },
          { from: 'A', to: 'A', message: 'y' },
        ],
      })
    ).toBeNull()
  })

  it('bounds participants, calls and label length', () => {
    const many = Array.from({ length: 20 }, (_, i) => `C${i}`)
    const d = cleanSequenceDiagram({
      participants: many,
      steps: Array.from({ length: 40 }, (_, i) => ({
        from: many[i % 8],
        to: many[(i + 1) % 8],
        message: 'm'.repeat(500),
      })),
    })!
    expect(d.participants.length).toBeLessThanOrEqual(
      SEQUENCE_DIAGRAM_MAX_PARTICIPANTS
    )
    expect(d.steps).toHaveLength(SEQUENCE_DIAGRAM_MAX_STEPS)
    for (const s of d.steps)
      expect(s.message.length).toBeLessThanOrEqual(
        SEQUENCE_DIAGRAM_MESSAGE_MAX_CHARS
      )
  })

  it('redacts secrets and drops markup, mentions and links from labels', () => {
    const d = cleanSequenceDiagram({
      participants: ['Client', `Vault ${KEY}`],
      steps: [
        {
          from: 'Client',
          to: `Vault ${KEY}`,
          message: `send ${KEY} to [x](https://evil.example) @someone <b>`,
        },
        { from: `Vault ${KEY}`, to: 'Client', message: 'ok', reply: true },
      ],
    })!
    const text = JSON.stringify(d)
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('https')
    expect(text).not.toContain('@')
    expect(text).not.toMatch(/[<>]/)
  })

  it('reads its own stored form back unchanged (idempotent)', () => {
    const d = cleanSequenceDiagram(FLOW)!
    expect(parseSequenceDiagram(JSON.parse(JSON.stringify(d)))).toEqual(d)
  })
})

describe('diagramLabel', () => {
  it('keeps plain text and strips syntax characters', () => {
    expect(diagramLabel('fetch PR diff', 60)).toBe('fetch PR diff')
    expect(diagramLabel('a;b#c:d', 60)).toBe('a b c d')
    expect(diagramLabel('x-->>y', 60)).toBe('x-y')
    expect(diagramLabel(42, 60)).toBe('')
  })
})

describe('renderSequenceDiagram + isValidSequenceDiagramSource', () => {
  it('renders the fixed grammar and validates it', () => {
    const source = renderSequenceDiagram(cleanSequenceDiagram(FLOW)!)
    expect(source).toBe(
      [
        'sequenceDiagram',
        '    autonumber',
        '    participant P1 as Web UI',
        '    participant P2 as API route',
        '    participant P3 as Review service',
        '    participant P4 as GitHub',
        '    P1->>P2: POST settings',
        '    P2->>P3: update(repo)',
        '    P3->>P4: fetch PR diff',
        '    P3-->>P2: saved',
      ].join('\n')
    )
    expect(isValidSequenceDiagramSource(source)).toBe(true)
  })

  it('rejects anything outside the grammar or the bounds', () => {
    const ok = renderSequenceDiagram(cleanSequenceDiagram(FLOW)!)
    expect(isValidSequenceDiagramSource('')).toBe(false)
    expect(isValidSequenceDiagramSource('graph TD\n A-->B')).toBe(false)
    expect(isValidSequenceDiagramSource(`${ok}\n    Note over P1: hi`)).toBe(
      false
    )
    expect(isValidSequenceDiagramSource(`${ok}\n    P1->>P9: ghost`)).toBe(
      false
    )
    expect(isValidSequenceDiagramSource(`${ok}\n    P1->>P2: a;b`)).toBe(false)
    expect(
      isValidSequenceDiagramSource(
        ok.replace('participant P2 as API route', 'participant P2 as a%%b')
      )
    ).toBe(false)
    // Only one participant / one call.
    expect(
      isValidSequenceDiagramSource(
        [
          'sequenceDiagram',
          '    autonumber',
          '    participant P1 as A',
          '    P1->>P1: x',
        ].join('\n')
      )
    ).toBe(false)
  })

  it('every rendered diagram parses with the real Mermaid parser, hostile labels included', () => {
    const sources: string[] = [
      renderSequenceDiagram(cleanSequenceDiagram(FLOW)!),
    ]
    HOSTILE.forEach((a, i) => {
      const b = HOSTILE[(i + 1) % HOSTILE.length]!
      const c = HOSTILE[(i + 5) % HOSTILE.length]!
      const d = cleanSequenceDiagram({
        participants: [a, b, 'Service'],
        steps: [
          { from: a, to: b, message: c },
          { from: b, to: 'Service', message: a, reply: true },
          { from: 'Service', to: a, message: b },
        ],
      })
      if (!d) return
      const source = renderSequenceDiagram(d)
      expect(isValidSequenceDiagramSource(source)).toBe(true)
      expect(source).not.toContain(KEY)
      sources.push(source)
    })
    expect(sources.length).toBeGreaterThan(HOSTILE.length / 2)
    const results = mermaidParse(sources)
    results.forEach((r, i) => {
      if (!r.ok) throw new Error(`${r.error}\n---\n${sources[i]}`)
      expect(r.type).toBe('sequence')
    })
  }, 60_000)

  it('the parser harness does catch broken Mermaid (the check is real)', () => {
    const [bad] = mermaidParse(['sequenceDiagram\n    P1->>: hi'])
    expect(bad!.ok).toBe(false)
  }, 60_000)
})

describe('sequenceDiagramSection', () => {
  it('is a mermaid-fenced walkthrough section for a stored diagram', () => {
    const section = sequenceDiagramSection(cleanSequenceDiagram(FLOW))!
    expect(section.title).toBe('Sequence diagram')
    expect(section.body.startsWith('```mermaid\nsequenceDiagram\n')).toBe(true)
    expect(section.body.endsWith('\n```')).toBe(true)
    const walkthrough = buildWalkthrough([section])!
    expect(walkthrough).toContain('**Sequence diagram**')
    expect(walkthrough).toContain('```mermaid')
  })

  it('is null for no diagram or one that does not clean', () => {
    expect(sequenceDiagramSection(null)).toBeNull()
    expect(sequenceDiagramSection(undefined)).toBeNull()
    expect(
      sequenceDiagramSection({ participants: ['A'], steps: [] })
    ).toBeNull()
  })
})

describe('sequenceDiagramEligible (trivial PRs are skipped)', () => {
  const f = (path: string, additions: number, deletions = 0) => ({
    path,
    additions,
    deletions,
  })

  it('needs two changed source files with enough changed lines', () => {
    expect(
      sequenceDiagramEligible([f('src/a.ts', 15), f('lib/b.py', 10)])
    ).toBe(true)
    expect(sequenceDiagramEligible([f('src/a.ts', 300)])).toBe(false)
    expect(
      sequenceDiagramEligible([f('src/a.ts', 3), f('src/b.ts', 2, 1)])
    ).toBe(false)
    expect(sequenceDiagramEligible([])).toBe(false)
  })

  it('does not count tests, docs, migrations or config', () => {
    expect(
      sequenceDiagramEligible([
        f('src/a.ts', 40),
        f('__tests__/a.test.ts', 40),
        f('docs/flow.md', 40),
        f('prisma/migrations/1_x/migration.sql', 40),
        f('package.json', 40),
        f('src/a.spec.ts', 40),
      ])
    ).toBe(false)
    expect(isFlowFile('src/service.ts')).toBe(true)
    expect(isFlowFile('src/service.test.ts')).toBe(false)
    expect(isFlowFile('README.md')).toBe(false)
  })
})
