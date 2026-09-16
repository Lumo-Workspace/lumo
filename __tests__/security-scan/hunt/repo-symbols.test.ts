/**
 * @jest-environment node
 *
 * LUM-798 — the naming layer on its own: what a symbol id's NAME is, which
 * sink rule that name belongs to, and whether the line a candidate pointed at
 * really carries it. These three answers are what the mechanical gate uses
 * instead of "is this id in `g.symbols`", which rejected 23 of 23 candidates.
 */
import {
  SIGHTING_LINE_WINDOW,
  candidateSymbolRefs,
  matchEntryRule,
  matchSinkRule,
  nameTokens,
  sightingKey,
  sightingsInSource,
  symbolNameOf,
} from '@/lib/security-scan/hunt/repo-symbols'

describe('LUM-798 symbol names', () => {
  it('reads the name out of every symbol-id shape', () => {
    expect(symbolNameOf('lib/s.ts#taskService.update')).toBe(
      'taskService.update'
    )
    expect(symbolNameOf('lib/s.ts#prisma.$queryRawUnsafe@5')).toBe(
      'prisma.$queryRawUnsafe'
    )
    expect(symbolNameOf('generateText')).toBe('generateText')
    // An `@` that is not a line number is part of the name, not a suffix.
    expect(symbolNameOf('lib/s.ts#scope@team')).toBe('scope@team')
  })

  it('looks for the name as written and its last identifier token only', () => {
    expect(nameTokens('documentRepository.findWithPermission')).toEqual([
      'documentRepository.findWithPermission',
      'findWithPermission',
    ])
    expect(nameTokens('generateText')).toEqual(['generateText'])
    // Taking every token would let a generic prefix match any line at all.
    expect(nameTokens('prisma.$queryRawUnsafe')).not.toContain('prisma')
  })
})

describe('LUM-798 sink rules place a library callee', () => {
  it('matches the callee tables, including a dotted receiver and a constructor', () => {
    expect(matchSinkRule('lib/ai/x.ts#generateText@4')?.id).toBe('llm-call')
    expect(matchSinkRule('writeFileSync')?.id).toBe('fs-write')
    expect(matchSinkRule('cp.exec')?.id).toBe('child-process')
    expect(matchSinkRule('lib/s.ts#prisma.$queryRawUnsafe@5')?.id).toBe(
      'prisma-raw'
    )
    expect(matchSinkRule('Function')?.id).toBe('new-function')
  })

  it('matches a candidate that named the sink CATEGORY or the node module', () => {
    // Production submitted both spellings; both mean the same rule, and
    // neither can ever have a `<file>#<name>` id.
    expect(matchSinkRule('child-process')?.id).toBe('child-process')
    expect(matchSinkRule('child_process')?.id).toBe('child-process')
  })

  it('places nothing it does not recognise', () => {
    expect(matchSinkRule('lib/s.ts#gitGate@2')).toBeNull()
    expect(matchSinkRule('documentRepository.findWithPermission')).toBeNull()
  })

  it('reads an entry rule as a signal, and never guesses at a directive rule', () => {
    expect(matchEntryRule('app/api/tasks/route.ts', 'POST')?.id).toBe(
      'next-route-handler'
    )
    expect(matchEntryRule('cli/src/commands/verify.ts', 'anything')?.id).toBe(
      'cli-command'
    )
    // `next-server-action` needs the file's first line, which a symbol id
    // does not carry — so it abstains rather than claiming a match.
    expect(matchEntryRule('lib/actions/save.ts', 'save')).toBeNull()
  })
})

describe('LUM-798 sightings', () => {
  const FILE = 'lib/repositories/document.repository.ts'
  const SOURCE = [
    'export const documentRepository = {',
    '  async read(id: string, userId: string) {',
    '    return documentRepository.findWithPermission(',
    '      id,',
    '    )',
    '  },',
    '}',
  ].join('\n')

  const refFor = (line: number, symbol: string) =>
    candidateSymbolRefs({ sink: { symbol, file: FILE, line } })

  it('confirms a name at the line the candidate claimed, within the wrap window', () => {
    const symbol = `${FILE}#documentRepository.findWithPermission@3`
    for (const line of [3, 3 + SIGHTING_LINE_WINDOW]) {
      expect(sightingsInSource(refFor(line, symbol), FILE, SOURCE)).toEqual([
        sightingKey({ symbol, file: FILE, line }),
      ])
    }
    // Past the window there is no sighting — the claim has to be about the
    // site it named, not about the file somewhere.
    expect(
      sightingsInSource(refFor(6 + SIGHTING_LINE_WINDOW, symbol), FILE, SOURCE)
    ).toEqual([])
  })

  it('will not confirm an identifier that only occurs inside a longer word', () => {
    // `y` is in `documentRepository`, but not as an identifier — this is the
    // substring trap a naive `line.includes(name)` would fall into.
    expect(sightingsInSource(refFor(3, `${FILE}#y@3`), FILE, SOURCE)).toEqual(
      []
    )
  })

  it('ignores files it was not asked about and claims it cannot read', () => {
    const symbol = `${FILE}#documentRepository.findWithPermission@3`
    expect(
      sightingsInSource(refFor(3, symbol), 'lib/other.ts', SOURCE)
    ).toEqual([])
    expect(candidateSymbolRefs({ sink: { symbol, file: FILE } })).toEqual([])
    expect(
      candidateSymbolRefs({ sink: { symbol, file: FILE, line: 0 } })
    ).toEqual([])
    expect(candidateSymbolRefs(null)).toEqual([])
  })
})
