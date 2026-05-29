import { trapToContent, trapFromContent, trapIsValid, trapDefault } from '@/app/workspace/[workspaceUrl]/components/memory/forms/trap.helpers'
import { decisionToContent, decisionFromContent, decisionIsValid } from '@/app/workspace/[workspaceUrl]/components/memory/forms/decision.helpers'
import { conventionToContent, conventionIsValid } from '@/app/workspace/[workspaceUrl]/components/memory/forms/convention.helpers'
import { proceduralToContent, proceduralFromContent, proceduralIsValid } from '@/app/workspace/[workspaceUrl]/components/memory/forms/procedural.helpers'
import { parseMemoryContent } from '@/lib/memory/schemas'

describe('TrapForm helpers', () => {
  it('trapIsValid requires trigger + outcome', () => {
    expect(trapIsValid(trapDefault())).toBe(false)
    expect(trapIsValid({ trigger: 'a', outcome: 'b', workaround: '' })).toBe(true)
  })
  it('trapToContent trims and drops empty workaround; output passes the schema', () => {
    const c = trapToContent({ trigger: ' a ', outcome: ' b ', workaround: '  ' })
    expect(c).toEqual({ trigger: 'a', outcome: 'b' })
    expect(() => parseMemoryContent('TRAP', c)).not.toThrow()
  })
  it('trapToContent keeps a non-empty workaround', () => {
    expect(trapToContent({ trigger: 'a', outcome: 'b', workaround: 'w' })).toEqual({ trigger: 'a', outcome: 'b', workaround: 'w' })
  })
  it('trapFromContent hydrates from content with defaults', () => {
    expect(trapFromContent({ trigger: 'a', outcome: 'b' })).toEqual({ trigger: 'a', outcome: 'b', workaround: '' })
    expect(trapFromContent(null)).toEqual({ trigger: '', outcome: '', workaround: '' })
  })
})

describe('DecisionForm helpers', () => {
  it('decisionIsValid requires what + why', () => {
    expect(decisionIsValid({ what: '', why: 'x', alternatives: '', implications: '' })).toBe(false)
    expect(decisionIsValid({ what: 'a', why: 'b', alternatives: '', implications: '' })).toBe(true)
  })
  it('decisionToContent drops empty optionals; output passes the schema', () => {
    const c = decisionToContent({ what: 'a', why: 'b', alternatives: '', implications: '' })
    expect(c).toEqual({ what: 'a', why: 'b' })
    expect(() => parseMemoryContent('DECISION', c)).not.toThrow()
  })
  it('decisionFromContent round-trips', () => {
    expect(decisionFromContent({ what: 'a', why: 'b', alternatives: 'c', implications: 'd' })).toEqual({ what: 'a', why: 'b', alternatives: 'c', implications: 'd' })
  })
})

describe('ConventionForm helpers', () => {
  it('conventionIsValid requires rule + scope', () => {
    expect(conventionIsValid({ rule: 'a', scope: '' })).toBe(false)
    expect(conventionIsValid({ rule: 'a', scope: 'b' })).toBe(true)
  })
  it('conventionToContent output passes the schema', () => {
    const c = conventionToContent({ rule: ' a ', scope: ' b ' })
    expect(c).toEqual({ rule: 'a', scope: 'b' })
    expect(() => parseMemoryContent('CONVENTION', c)).not.toThrow()
  })
})

describe('ProceduralForm helpers', () => {
  it('proceduralIsValid requires workflow + trigger', () => {
    expect(proceduralIsValid({ workflow: 'a', trigger: '', steps: [] })).toBe(false)
    expect(proceduralIsValid({ workflow: 'a', trigger: 'b', steps: [] })).toBe(true)
  })
  it('proceduralToContent drops empty steps and trims; output passes the schema', () => {
    const c = proceduralToContent({ workflow: 'a', trigger: 'b', steps: [' s1 ', '  ', 's2'] })
    expect(c).toEqual({ workflow: 'a', trigger: 'b', steps: ['s1', 's2'] })
    expect(() => parseMemoryContent('PROCEDURAL', c)).not.toThrow()
  })
  it('proceduralToContent omits steps when all empty', () => {
    expect(proceduralToContent({ workflow: 'a', trigger: 'b', steps: ['', '  '] })).toEqual({ workflow: 'a', trigger: 'b' })
  })
  it('proceduralFromContent defaults steps to []', () => {
    expect(proceduralFromContent({ workflow: 'a', trigger: 'b' }).steps).toEqual([])
  })
})
