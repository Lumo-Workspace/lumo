import { mapLevelToPriority } from '@/lib/integrations/sentry/payload'

describe('mapLevelToPriority', () => {
  it('maps fatal → URGENT', () => {
    expect(mapLevelToPriority('fatal')).toBe('URGENT')
  })
  it('maps error → HIGH', () => {
    expect(mapLevelToPriority('error')).toBe('HIGH')
  })
  it('maps warning → MEDIUM', () => {
    expect(mapLevelToPriority('warning')).toBe('MEDIUM')
  })
  it('maps info → LOW', () => {
    expect(mapLevelToPriority('info')).toBe('LOW')
  })
  it('maps debug → LOW', () => {
    expect(mapLevelToPriority('debug')).toBe('LOW')
  })
  it('maps unknown → LOW', () => {
    expect(mapLevelToPriority('something-new')).toBe('LOW')
  })
  it('maps undefined → LOW', () => {
    expect(mapLevelToPriority(undefined)).toBe('LOW')
  })
})
