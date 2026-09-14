import {
  INTEGRATIONS,
  getIntegrationKind,
  type IntegrationId,
} from '@/lib/integrations/registry'

describe('integration registry', () => {
  const ALL_IDS: IntegrationId[] = [
    'slack',
    'sentry',
    'github',
    'githubAccount',
    'figma',
    'googleDrive',
  ]

  it('has a descriptor for every integration id', () => {
    for (const id of ALL_IDS) {
      expect(INTEGRATIONS[id]).toBeDefined()
      expect(INTEGRATIONS[id].id).toBe(id)
    }
    expect(Object.keys(INTEGRATIONS).sort()).toEqual([...ALL_IDS].sort())
  })

  it('classifies kinds correctly (the App is TEAM, a member GitHub link is PERSONAL)', () => {
    expect(getIntegrationKind('slack')).toBe('TEAM')
    expect(getIntegrationKind('sentry')).toBe('TEAM')
    expect(getIntegrationKind('github')).toBe('TEAM')
    expect(getIntegrationKind('githubAccount')).toBe('PERSONAL')
    expect(getIntegrationKind('figma')).toBe('PERSONAL')
    expect(getIntegrationKind('googleDrive')).toBe('PERSONAL')
  })

  it('only uses valid kind values', () => {
    for (const id of ALL_IDS) {
      expect(['TEAM', 'PERSONAL']).toContain(INTEGRATIONS[id].kind)
    }
  })
})
