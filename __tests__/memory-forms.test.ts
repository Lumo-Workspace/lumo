import {
  trapToContent,
  trapFromContent,
  trapIsValid,
  trapDefault,
} from '@/app/workspace/[workspaceUrl]/components/memory/forms/trap.helpers'
import {
  decisionToContent,
  decisionFromContent,
  decisionIsValid,
} from '@/app/workspace/[workspaceUrl]/components/memory/forms/decision.helpers'
import {
  conventionToContent,
  conventionIsValid,
} from '@/app/workspace/[workspaceUrl]/components/memory/forms/convention.helpers'
import {
  proceduralToContent,
  proceduralFromContent,
  proceduralIsValid,
} from '@/app/workspace/[workspaceUrl]/components/memory/forms/procedural.helpers'
import { parseMemoryContent } from '@/lib/memory/schemas'

describe('TrapForm helpers', () => {
  it('trapIsValid requires trigger + outcome', () => {
    expect(trapIsValid(trapDefault())).toBe(false)
    expect(
      trapIsValid({ trigger: 'a', outcome: 'b', workaround: '', summary: '' })
    ).toBe(true)
  })
  it('trapToContent trims and drops empty workaround; output passes the schema', () => {
    const c = trapToContent({
      trigger: ' a ',
      outcome: ' b ',
      workaround: '  ',
      summary: '',
    })
    expect(c).toEqual({ trigger: 'a', outcome: 'b' })
    expect(() => parseMemoryContent('TRAP', c)).not.toThrow()
  })
  it('trapToContent keeps a non-empty workaround', () => {
    expect(
      trapToContent({
        trigger: 'a',
        outcome: 'b',
        workaround: 'w',
        summary: '',
      })
    ).toEqual({ trigger: 'a', outcome: 'b', workaround: 'w' })
  })
  it('trapFromContent hydrates from content with defaults', () => {
    expect(trapFromContent({ trigger: 'a', outcome: 'b' })).toEqual({
      trigger: 'a',
      outcome: 'b',
      workaround: '',
      summary: '',
    })
    expect(trapFromContent(null)).toEqual({
      trigger: '',
      outcome: '',
      workaround: '',
      summary: '',
    })
  })
  it('trapToContent keeps a non-empty summary and drops an empty one', () => {
    expect(
      trapToContent({
        trigger: 'a',
        outcome: 'b',
        workaround: '',
        summary: ' s ',
      })
    ).toEqual({ trigger: 'a', outcome: 'b', summary: 's' })
    expect(
      trapToContent({
        trigger: 'a',
        outcome: 'b',
        workaround: '',
        summary: '  ',
      })
    ).toEqual({ trigger: 'a', outcome: 'b' })
  })
  it('trapFromContent round-trips a summary', () => {
    expect(
      trapFromContent({ trigger: 'a', outcome: 'b', summary: 's' }).summary
    ).toBe('s')
  })
})

describe('DecisionForm helpers', () => {
  it('decisionIsValid requires what + why', () => {
    expect(
      decisionIsValid({
        what: '',
        why: 'x',
        alternatives: '',
        implications: '',
        summary: '',
      })
    ).toBe(false)
    expect(
      decisionIsValid({
        what: 'a',
        why: 'b',
        alternatives: '',
        implications: '',
        summary: '',
      })
    ).toBe(true)
  })
  it('decisionToContent drops empty optionals; output passes the schema', () => {
    const c = decisionToContent({
      what: 'a',
      why: 'b',
      alternatives: '',
      implications: '',
      summary: '',
    })
    expect(c).toEqual({ what: 'a', why: 'b' })
    expect(() => parseMemoryContent('DECISION', c)).not.toThrow()
  })
  it('decisionFromContent round-trips', () => {
    expect(
      decisionFromContent({
        what: 'a',
        why: 'b',
        alternatives: 'c',
        implications: 'd',
      })
    ).toEqual({
      what: 'a',
      why: 'b',
      alternatives: 'c',
      implications: 'd',
      summary: '',
    })
  })
  it('decisionToContent keeps a non-empty summary and drops an empty one', () => {
    expect(
      decisionToContent({
        what: 'a',
        why: 'b',
        alternatives: '',
        implications: '',
        summary: ' s ',
      })
    ).toEqual({ what: 'a', why: 'b', summary: 's' })
    expect(
      decisionToContent({
        what: 'a',
        why: 'b',
        alternatives: '',
        implications: '',
        summary: '',
      })
    ).toEqual({ what: 'a', why: 'b' })
  })
})

describe('ConventionForm helpers', () => {
  it('conventionIsValid requires rule + scope', () => {
    expect(conventionIsValid({ rule: 'a', scope: '', summary: '' })).toBe(false)
    expect(conventionIsValid({ rule: 'a', scope: 'b', summary: '' })).toBe(true)
  })
  it('conventionToContent output passes the schema', () => {
    const c = conventionToContent({ rule: ' a ', scope: ' b ', summary: '' })
    expect(c).toEqual({ rule: 'a', scope: 'b' })
    expect(() => parseMemoryContent('CONVENTION', c)).not.toThrow()
  })
  it('conventionToContent keeps a non-empty summary and drops an empty one', () => {
    expect(
      conventionToContent({ rule: 'a', scope: 'b', summary: ' s ' })
    ).toEqual({ rule: 'a', scope: 'b', summary: 's' })
    expect(conventionToContent({ rule: 'a', scope: 'b', summary: '' })).toEqual(
      { rule: 'a', scope: 'b' }
    )
  })
})

describe('ProceduralForm helpers', () => {
  it('proceduralIsValid requires workflow + trigger', () => {
    expect(
      proceduralIsValid({ workflow: 'a', trigger: '', steps: [], summary: '' })
    ).toBe(false)
    expect(
      proceduralIsValid({ workflow: 'a', trigger: 'b', steps: [], summary: '' })
    ).toBe(true)
  })
  it('proceduralToContent drops empty steps and trims; output passes the schema', () => {
    const c = proceduralToContent({
      workflow: 'a',
      trigger: 'b',
      steps: [' s1 ', '  ', 's2'],
      summary: '',
    })
    expect(c).toEqual({ workflow: 'a', trigger: 'b', steps: ['s1', 's2'] })
    expect(() => parseMemoryContent('PROCEDURAL', c)).not.toThrow()
  })
  it('proceduralToContent omits steps when all empty', () => {
    expect(
      proceduralToContent({
        workflow: 'a',
        trigger: 'b',
        steps: ['', '  '],
        summary: '',
      })
    ).toEqual({ workflow: 'a', trigger: 'b' })
  })
  it('proceduralFromContent defaults steps to []', () => {
    expect(
      proceduralFromContent({ workflow: 'a', trigger: 'b' }).steps
    ).toEqual([])
  })
  it('proceduralFromContent defaults summary to ""', () => {
    expect(proceduralFromContent({ workflow: 'a', trigger: 'b' }).summary).toBe(
      ''
    )
  })
  it('proceduralToContent keeps a non-empty summary and drops an empty one', () => {
    expect(
      proceduralToContent({
        workflow: 'a',
        trigger: 'b',
        steps: [],
        summary: ' s ',
      })
    ).toEqual({ workflow: 'a', trigger: 'b', summary: 's' })
    expect(
      proceduralToContent({
        workflow: 'a',
        trigger: 'b',
        steps: [],
        summary: '',
      })
    ).toEqual({ workflow: 'a', trigger: 'b' })
  })
})
