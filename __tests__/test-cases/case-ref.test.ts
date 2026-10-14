import { parseCaseRef } from '@/lib/test-cases/case-ref'

describe('parseCaseRef', () => {
  it.each([
    ['TC3', { kind: 'number', number: 3 }],
    ['tc12', { kind: 'number', number: 12 }],
    ['7', { kind: 'number', number: 7 }],
    [' TC2 ', { kind: 'number', number: 2 }],
    [
      'cabcdefghijklmnopqrstuvwx',
      { kind: 'id', id: 'cabcdefghijklmnopqrstuvwx' },
    ],
  ])('%s', (raw, expected) => {
    expect(parseCaseRef(raw)).toEqual(expected)
  })

  it.each(['TC0', '0', '-1', 'TC', 'LUM-1/TC1', '', 'TC1.5'])(
    'rejects %s',
    raw => {
      expect(parseCaseRef(raw)).toBeNull()
    }
  )
})
