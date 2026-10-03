// __tests__/lib/context/injection-metrics.test.ts
//
// Tests for buildSessionStartContextMetrics (LUM-402/LUM-500).
// Each section gets a distinct string so token estimates differ.

import { buildSessionStartContextMetrics } from '@/lib/context/injection-metrics'

const STUB_ALLOCATION = {
  memory: {
    keptCards: 5,
    droppedCards: 2,
    keptTokens: 500,
    droppedTokens: 200,
  },
  pr: { keptCards: 1, droppedCards: 0, keptTokens: 100, droppedTokens: 0 },
  slack: { keptCards: 0, droppedCards: 0, keptTokens: 0, droppedTokens: 0 },
  figma: { keptCards: 0, droppedCards: 0, keptTokens: 0, droppedTokens: 0 },
  web: { keptCards: 0, droppedCards: 0, keptTokens: 0, droppedTokens: 0 },
  layer2Review: { keptCards: 2, droppedCards: 1 },
}

const INPUT = {
  budgetTokens: 10_000,
  allocation: STUB_ALLOCATION,
  // Each section has a distinct string length so estimated tokens differ
  memorySection: 'memory-section ' + 'b'.repeat(300),
  linkedResourcesSection: 'linked-resources-section ' + 'c'.repeat(150),
  reviewTodosSection: 'review-todos-section ' + 'd'.repeat(80),
  progressSection: 'progress-section ' + 'e'.repeat(100),
  layer2ReviewSection: 'layer2-review-section ' + 'f'.repeat(120),
  blockerWarningSection: 'blocker-warning-section ' + 'g'.repeat(60),
}

describe('buildSessionStartContextMetrics', () => {
  const metrics = buildSessionStartContextMetrics(INPUT)

  it('returns version 1', () => {
    expect(metrics.version).toBe(1)
  })

  it('preserves budgetTokens', () => {
    expect(metrics.budgetTokens).toBe(INPUT.budgetTokens)
  })

  it('totalTokens equals sum of all sectionTokens', () => {
    const { sectionTokens, totalTokens } = metrics
    const sum =
      sectionTokens.memory +
      sectionTokens.linkedResources +
      sectionTokens.reviewTodos +
      sectionTokens.progress +
      sectionTokens.layer2Review +
      sectionTokens.blockerWarning
    expect(totalTokens).toBe(sum)
  })

  describe('tierTokens (LUM-500 progressive disclosure)', () => {
    it('tier0 equals blockerWarning', () => {
      const { sectionTokens, tierTokens } = metrics
      expect(tierTokens.tier0).toBe(sectionTokens.blockerWarning)
    })

    it('tier1 equals progress + reviewTodos + layer2Review', () => {
      const { sectionTokens, tierTokens } = metrics
      expect(tierTokens.tier1).toBe(
        sectionTokens.progress +
          sectionTokens.reviewTodos +
          sectionTokens.layer2Review
      )
    })

    it('tier2 equals memory + linkedResources', () => {
      const { sectionTokens, tierTokens } = metrics
      expect(tierTokens.tier2).toBe(
        sectionTokens.memory + sectionTokens.linkedResources
      )
    })

    it('tier0 + tier1 + tier2 === totalTokens (every section in exactly one tier)', () => {
      const { tierTokens, totalTokens } = metrics
      expect(tierTokens.tier0 + tierTokens.tier1 + tierTokens.tier2).toBe(
        totalTokens
      )
    })

    it('each tier value is a non-negative integer', () => {
      const { tierTokens } = metrics
      for (const [, val] of Object.entries(tierTokens)) {
        expect(typeof val).toBe('number')
        expect(val).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(val)).toBe(true)
      }
    })
  })

  it('works when progressSection is empty (zero tokens for that section)', () => {
    const metricsEmpty = buildSessionStartContextMetrics({
      ...INPUT,
      progressSection: '',
    })
    expect(metricsEmpty.sectionTokens.progress).toBe(0)
    // tier1 still sums correctly
    expect(metricsEmpty.tierTokens.tier1).toBe(
      0 +
        metricsEmpty.sectionTokens.reviewTodos +
        metricsEmpty.sectionTokens.layer2Review
    )
    // invariant holds
    expect(
      metricsEmpty.tierTokens.tier0 +
        metricsEmpty.tierTokens.tier1 +
        metricsEmpty.tierTokens.tier2
    ).toBe(metricsEmpty.totalTokens)
  })
})
