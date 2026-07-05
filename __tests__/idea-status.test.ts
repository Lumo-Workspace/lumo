import {
  IDEA_STATUS_TRANSITIONS,
  allowedIdeaStatusTransitions,
  canTransitionIdeaStatus,
  isTerminalIdeaStatus,
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
