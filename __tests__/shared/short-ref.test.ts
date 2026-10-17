import {
  isFullCuid,
  matchRef,
  normaliseRef,
  refMatchError,
  shortRef,
} from '@/shared/src/short-ref'

const A = 'cmva568gc00l506jvpskvl3sh'
const B = 'cmva568fw00l106jv6z9j2q6d'
const items = [{ id: A }, { id: B }]
const idOf = (i: { id: string }) => i.id

describe('shortRef (LUM-1230)', () => {
  it('is the random tail of a cuid, so batch-created ids stay distinct', () => {
    expect(shortRef(A)).toBe('pskvl3sh')
    expect(shortRef(B)).toBe('6z9j2q6d')
    // Their 8-char prefixes collide — the reason the tail is used.
    expect(A.slice(0, 7)).toBe(B.slice(0, 7))
  })

  it('leaves an id of 8 chars or fewer as is', () => {
    expect(shortRef('abc')).toBe('abc')
  })
})

describe('isFullCuid / normaliseRef', () => {
  it('recognises a 25-char cuid only', () => {
    expect(isFullCuid(A)).toBe(true)
    expect(isFullCuid('pskvl3sh')).toBe(false)
    expect(isFullCuid('7129f67e-232f-4171-b02b-f5bece6ec12e')).toBe(false)
  })

  it('trims, drops a leading # and lowercases', () => {
    expect(normaliseRef('  #PSKVL3SH ')).toBe('pskvl3sh')
  })
})

describe('matchRef', () => {
  it('finds by full id (old scripts keep working)', () => {
    expect(matchRef(A, items, idOf)).toEqual({ kind: 'found', item: items[0] })
  })

  it('finds by the 8-char short ref', () => {
    expect(matchRef('6z9j2q6d', items, idOf)).toEqual({
      kind: 'found',
      item: items[1],
    })
  })

  it('finds by a unique prefix of at least 6 chars', () => {
    expect(matchRef('cmva568gc', items, idOf)).toEqual({
      kind: 'found',
      item: items[0],
    })
  })

  it('reports an ambiguous prefix with every candidate', () => {
    const m = matchRef('cmva568', items, idOf)
    expect(m).toEqual({ kind: 'ambiguous', candidates: items })
  })

  it('rejects refs shorter than 6 chars', () => {
    expect(matchRef('pskv', items, idOf)).toEqual({ kind: 'too-short' })
  })

  it('reports not-found', () => {
    expect(matchRef('zzzzzzzz', items, idOf)).toEqual({ kind: 'not-found' })
  })
})

describe('refMatchError', () => {
  it('names every candidate (with its label) on ambiguity', () => {
    const msg = refMatchError(
      'memory',
      'cmva568',
      { kind: 'ambiguous', candidates: items },
      idOf,
      () => 'TRAP'
    )
    expect(msg).toContain(`${A} (TRAP)`)
    expect(msg).toContain(`${B} (TRAP)`)
    expect(msg).toContain('ambiguous')
  })

  it('explains the minimum length', () => {
    expect(
      refMatchError('artifact', 'ab', { kind: 'too-short' }, idOf)
    ).toMatch(/too short/)
  })

  it('says nothing matched', () => {
    expect(
      refMatchError('artifact', 'zzzzzzzz', { kind: 'not-found' }, idOf)
    ).toBe('no artifact matches "zzzzzzzz"')
  })
})
