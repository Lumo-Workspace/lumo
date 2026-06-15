import {
  severityFor,
  isReversible,
} from '@/lib/services/boundary-detector.service'
import type { BoundaryCrossingCategory } from '@prisma/client'

describe('SESSION_BINDING_MISSING taxonomy', () => {
  it('is MEDIUM severity', () => {
    expect(severityFor('SESSION_BINDING_MISSING')).toBe('MEDIUM')
  })
  it('is reversible (no artifact mutated — a pure process signal)', () => {
    expect(isReversible('SESSION_BINDING_MISSING')).toBe(true)
  })
})

describe('reversibility taxonomy — world/external-state boundary (LUM-516)', () => {
  const REVERSIBLE: BoundaryCrossingCategory[] = [
    'NEW_NPM_DEPENDENCY',
    'TEST_TAMPERING',
    'CONTRACT_WEAKENING',
    'SPINOFF_LAUNDERED',
    'SILENT_FIX',
    'MIGRATION_FILE_DELETED',
    'SESSION_BINDING_MISSING',
    'PUSH_TO_PROTECTED_BRANCH',
  ]
  const IRREVERSIBLE: BoundaryCrossingCategory[] = [
    'HARDCODED_SECRET',
    'DESTRUCTIVE_DB_COMMAND',
    'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION',
    'INFRA_TERMINATION',
  ]

  it.each(REVERSIBLE)('%s is reversible', cat => {
    expect(isReversible(cat)).toBe(true)
  })
  it.each(IRREVERSIBLE)('%s is irreversible', cat => {
    expect(isReversible(cat)).toBe(false)
  })
  it('the table covers every BoundaryCrossingCategory enum value', () => {
    expect(new Set([...REVERSIBLE, ...IRREVERSIBLE]).size).toBe(13)
  })
  it('defaults an unknown/future category to irreversible', () => {
    expect(
      isReversible('SOME_FUTURE_CATEGORY' as BoundaryCrossingCategory)
    ).toBe(false)
  })
})
