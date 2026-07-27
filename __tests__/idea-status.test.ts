import {
  IDEA_STATUS_TRANSITIONS,
  allowedIdeaStatusTransitions,
  canTransitionIdeaStatus,
  isTerminalIdeaStatus,
  nextIdeaStatus,
} from '@/lib/idea-status'
import type { IdeaStatus } from '@prisma/client'

const ALL: IdeaStatus[] = ['CAPTURED', 'DEVELOPING', 'PLANNED', 'DROPPED']

describe('idea status transitions', () => {
  it('allows CAPTURED↔DEVELOPING both directions', () => {
    expect(canTransitionIdeaStatus('CAPTURED', 'DEVELOPING')).toBe(true)
    expect(canTransitionIdeaStatus('DEVELOPING', 'CAPTURED')).toBe(true)
  })

  it('allows DEVELOPING→PLANNED but not CAPTURED→PLANNED directly (manual path)', () => {
    expect(canTransitionIdeaStatus('DEVELOPING', 'PLANNED')).toBe(true)
    expect(canTransitionIdeaStatus('CAPTURED', 'PLANNED')).toBe(false)
  })

  it('allows any non-terminal status → DROPPED', () => {
    expect(canTransitionIdeaStatus('CAPTURED', 'DROPPED')).toBe(true)
    expect(canTransitionIdeaStatus('DEVELOPING', 'DROPPED')).toBe(true)
    expect(canTransitionIdeaStatus('PLANNED', 'DROPPED')).toBe(true)
  })

  it('treats DROPPED as terminal — no transition out of it', () => {
    expect(isTerminalIdeaStatus('DROPPED')).toBe(true)
    expect(allowedIdeaStatusTransitions('DROPPED')).toEqual([])
    for (const to of ALL) {
      expect(canTransitionIdeaStatus('DROPPED', to)).toBe(false)
    }
  })

  it('rejects same-status no-ops', () => {
    for (const s of ALL) {
      expect(canTransitionIdeaStatus(s, s)).toBe(false)
    }
  })

  it('never lists a status as its own allowed target, and every target is a known status', () => {
    for (const from of ALL) {
      const targets = allowedIdeaStatusTransitions(from)
      expect(targets).not.toContain(from)
      for (const to of targets) expect(ALL).toContain(to)
    }
  })

  it('exposes a transition map keyed by every IdeaStatus', () => {
    expect(Object.keys(IDEA_STATUS_TRANSITIONS).sort()).toEqual([...ALL].sort())
  })
})

describe('nextIdeaStatus (the one-click advance, LUM-708)', () => {
  it('walks the lifecycle forward one legal step at a time', () => {
    expect(nextIdeaStatus('CAPTURED')).toBe('DEVELOPING')
    expect(nextIdeaStatus('DEVELOPING')).toBe('PLANNED')
    expect(nextIdeaStatus('PLANNED')).toBe('DROPPED')
  })

  it('stops at the terminal status rather than wrapping around', () => {
    expect(nextIdeaStatus('DROPPED')).toBeNull()
  })

  it('only ever proposes a move the transition map allows', () => {
    for (const from of ALL) {
      const next = nextIdeaStatus(from)
      if (next === null) {
        expect(isTerminalIdeaStatus(from)).toBe(true)
        continue
      }
      expect(canTransitionIdeaStatus(from, next)).toBe(true)
    }
  })
})
