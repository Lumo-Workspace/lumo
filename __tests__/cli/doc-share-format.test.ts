import { normalizeRole } from '@/cli/src/commands/doc-share'
import {
  formatShareListRows,
  type ShareListRow,
} from '@/cli/src/commands/doc-share-list'
import { resolveMember, type MemberRow } from '@/cli/src/lib/resolve-member'

describe('normalizeRole', () => {
  it('uppercases viewer/editor/manager', () => {
    expect(normalizeRole('viewer')).toBe('VIEWER')
    expect(normalizeRole('Editor')).toBe('EDITOR')
    expect(normalizeRole('MANAGER')).toBe('MANAGER')
  })

  it('returns null for unknown roles', () => {
    expect(normalizeRole('owner')).toBeNull()
    expect(normalizeRole('admin')).toBeNull()
    expect(normalizeRole('')).toBeNull()
  })
})

describe('formatShareListRows', () => {
  it('returns empty when no shares', () => {
    expect(formatShareListRows([])).toEqual([])
  })

  it('pads displayName to widest entry', () => {
    const rows: ShareListRow[] = [
      { displayName: 'Alice', role: 'EDITOR' },
      { displayName: 'Bob Wong', role: 'VIEWER' },
    ]
    expect(formatShareListRows(rows)).toEqual([
      'Alice     EDITOR',
      'Bob Wong  VIEWER',
    ])
  })
})

describe('resolveMember', () => {
  const members: MemberRow[] = [
    { memberId: 'm1', displayName: 'Alice Wong', email: 'alice@x.com' },
    { memberId: 'm2', displayName: 'Bob', email: 'bob@x.com' },
    { memberId: 'm3', displayName: 'Bob', email: 'bob2@x.com' },
  ]

  it('resolves "me" via caller email (case-insensitive)', () => {
    const r = resolveMember(members, 'me', 'ALICE@x.com')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.member.memberId).toBe('m1')
  })

  it('resolves by email exact match', () => {
    const r = resolveMember(members, 'bob@x.com', 'alice@x.com')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.member.memberId).toBe('m2')
  })

  it('resolves by display name when unambiguous', () => {
    const r = resolveMember(members, 'Alice Wong', 'alice@x.com')
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.member.memberId).toBe('m1')
  })

  it('reports ambiguity on duplicate display name', () => {
    const r = resolveMember(members, 'Bob', 'alice@x.com')
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.candidates.map(c => c.memberId).sort()).toEqual(['m2', 'm3'])
    }
  })

  it('reports not_found on miss', () => {
    const r = resolveMember(members, 'carol@x.com', 'alice@x.com')
    expect(r.kind).toBe('not_found')
  })

  it('reports not_found for empty ref', () => {
    const r = resolveMember(members, '   ', 'alice@x.com')
    expect(r.kind).toBe('not_found')
  })

  it('reports not_found for "me" when caller email is absent from directory', () => {
    const r = resolveMember(members, 'me', 'unknown@x.com')
    expect(r.kind).toBe('not_found')
  })
})
