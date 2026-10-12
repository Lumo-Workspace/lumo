/**
 * @jest-environment node
 */
import {
  cmd,
  hint,
  HINT_PREFIX,
  quoteTitle,
  successLine,
} from '../../src/lib/feedback'

describe('successLine (LUM-1092)', () => {
  it('renders <Verb> <kind> <ref> "<title>"  <id>', () => {
    expect(
      successLine({
        verb: 'Created',
        kind: 'sprint',
        ref: '#3',
        title: 'Week 3',
        id: 'spr_1',
      })
    ).toBe('Created sprint #3 "Week 3"  spr_1')
  })

  it('drops missing parts and keeps the two-space id separator', () => {
    expect(
      successLine({ verb: 'Created', kind: 'tag', title: 'ui', id: 't1' })
    ).toBe('Created tag "ui"  t1')
    expect(
      successLine({ verb: 'Removed', kind: 'dependency', ref: '[ab]' })
    ).toBe('Removed dependency [ab]')
  })

  it('appends a suffix before the id', () => {
    expect(
      successLine({
        verb: 'Created',
        kind: 'task template',
        ref: 'brief',
        title: 'Brief',
        suffix: '(10 chars)',
      })
    ).toBe('Created task template brief "Brief" (10 chars)')
  })

  it('escapes quotes and strips control characters in the title', () => {
    expect(quoteTitle('say "hi"\u001b[31m')).toBe('"say \\"hi\\"[31m"')
  })
})

describe('hint / cmd (LUM-1092)', () => {
  it('uses the single Hint: prefix', () => {
    expect(HINT_PREFIX).toBe('Hint:')
    expect(hint('x')).toBe('Hint: x')
  })

  it('backticks command references', () => {
    expect(cmd('lumo task context LUM-1')).toBe('`lumo task context LUM-1`')
  })
})
