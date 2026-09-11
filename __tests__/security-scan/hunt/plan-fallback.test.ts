import { planFallback } from '@/lib/security-scan/hunt/plan-fallback'
import { HUNT_MAX_PLANNED_CATEGORIES } from '@/lib/services/security-hunt.config'

describe('planFallback', () => {
  it.each([
    ['diff:sink:prisma-raw', 'injection'],
    ['diff:sink:child-process', 'injection'],
    ['diff:sink:eval', 'injection'],
    ['diff:sink:new-function', 'injection'],
    ['diff:sink:fs-write', 'injection'],
    ['diff:sink:fetch', 'ssrf'],
    ['diff:sink:redirect', 'ssrf'],
    ['diff:sink:llm-call', 'prompt_injection'],
  ])('%s maps to %s', (reason, category) => {
    expect(planFallback([reason])).toEqual([category])
  })

  it('maps an entry with no auth/workspace control to idor', () => {
    expect(planFallback(['diff:entry:next-route-handler'])).toEqual(['idor'])
  })

  it('does not map to idor when the diff adds an auth control', () => {
    expect(
      planFallback(['diff:entry:next-route-handler', 'diff:control:auth'])
    ).toEqual([])
  })

  it('does not map to idor when the diff adds a workspace-scope control', () => {
    expect(
      planFallback([
        'diff:entry:next-route-handler',
        'diff:control:workspace-scope',
      ])
    ).toEqual([])
  })

  it('returns [] for intent-only reasons', () => {
    expect(planFallback(['stage-a:high', 'l4:open-crossing'])).toEqual([])
  })

  it('returns [] for unknown reasons', () => {
    expect(planFallback(['diff:sink:not-a-real-rule'])).toEqual([])
  })

  it('never returns race or logic', () => {
    const all = planFallback([
      'diff:sink:prisma-raw',
      'diff:sink:fetch',
      'diff:sink:llm-call',
      'diff:entry:next-route-handler',
      'stage-a:high',
    ])
    expect(all).not.toContain('race')
    expect(all).not.toContain('logic')
  })

  it('caps at HUNT_MAX_PLANNED_CATEGORIES in priority order', () => {
    expect(
      planFallback([
        'diff:sink:fetch',
        'diff:sink:llm-call',
        'diff:sink:prisma-raw',
        'diff:entry:next-route-handler',
      ])
    ).toEqual(['injection', 'idor'])
    expect(
      planFallback(['diff:sink:fetch', 'diff:sink:llm-call'])
    ).toHaveLength(HUNT_MAX_PLANNED_CATEGORIES)
  })

  it('deduplicates categories reached by two reasons', () => {
    expect(
      planFallback(['diff:sink:prisma-raw', 'diff:sink:child-process'])
    ).toEqual(['injection'])
  })
})
