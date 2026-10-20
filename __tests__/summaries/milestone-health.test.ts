import {
  computeMilestoneHealth,
  milestoneHealthFromCounts,
  NEAR_DEADLINE_DAYS,
  SCHEDULE_SLIP,
  type MilestoneHealthInput,
} from '@/lib/summaries/milestone-health'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-06-02T12:00:00Z')

function input(overrides: Partial<MilestoneHealthInput>): MilestoneHealthInput {
  return {
    completedAt: null,
    archived: false,
    startDate: null,
    targetDate: new Date('2026-07-01T00:00:00Z'),
    done: 0,
    total: 10,
    now,
    ...overrides,
  }
}

describe('computeMilestoneHealth', () => {
  describe('not applicable (returns null)', () => {
    // LUM-714: the old COMPLETED/CANCELLED pair became completedAt/archived.
    it('suppresses the health light for a completed milestone', () => {
      expect(
        computeMilestoneHealth(
          input({ completedAt: new Date('2026-06-01T00:00:00Z') })
        )
      ).toBeNull()
    })

    it('returns null for archived milestones', () => {
      expect(computeMilestoneHealth(input({ archived: true }))).toBeNull()
    })

    it('returns null when there is no target date', () => {
      expect(computeMilestoneHealth(input({ targetDate: null }))).toBeNull()
    })
  })

  describe('all tasks done', () => {
    it('is on-track even when the target date has passed', () => {
      expect(
        computeMilestoneHealth(
          input({
            done: 10,
            total: 10,
            targetDate: new Date('2026-05-01T00:00:00Z'), // already passed
          })
        )
      ).toBe('on-track')
    })
  })

  describe('overdue (calendar-day semantics)', () => {
    it('is overdue when now is past the end of the target day with work remaining', () => {
      expect(
        computeMilestoneHealth(
          input({
            done: 3,
            total: 10,
            targetDate: new Date('2026-06-01T00:00:00Z'), // ended yesterday
          })
        )
      ).toBe('overdue')
    })

    it('keeps the whole target day inside the deadline — never overdue on the day itself', () => {
      // now = 2026-06-02T12:00Z, target = calendar day 2026-06-02 (stored at
      // UTC midnight). Comparing against raw midnight would flag this as
      // overdue half a day early — the LUM-636 west-of-UTC bug.
      expect(
        computeMilestoneHealth(
          input({
            done: 3,
            total: 10,
            targetDate: new Date('2026-06-02T00:00:00Z'), // today
          })
        )
        // Not overdue; with work remaining and the deadline this close the
        // near-deadline fallback reads at-risk.
      ).toBe('at-risk')
    })

    it('flips to overdue exactly when the day after the target begins (UTC)', () => {
      expect(
        computeMilestoneHealth(
          input({
            done: 3,
            total: 10,
            targetDate: new Date('2026-06-01T00:00:00Z'),
            now: new Date('2026-06-02T00:00:00Z'), // first instant after the target day
          })
        )
      ).toBe('overdue')
    })
  })

  describe('pace-based (with start date)', () => {
    // Window: 2026-05-01 .. 2026-07-01 (61 days). now=2026-06-02 → ~52% elapsed.
    const startDate = new Date('2026-05-01T00:00:00Z')
    const targetDate = new Date('2026-07-01T00:00:00Z')

    it('is at-risk when progress lags elapsed time by more than the slip allowance', () => {
      // elapsed ~0.52, progress 0.1 → 0.1 < 0.52 - 0.2 → at-risk
      expect(
        computeMilestoneHealth(
          input({ startDate, targetDate, done: 1, total: 10 })
        )
      ).toBe('at-risk')
    })

    it('is on-track when progress keeps up with elapsed time', () => {
      // elapsed ~0.52, progress 0.5 → 0.5 >= 0.52 - 0.2 → on-track
      expect(
        computeMilestoneHealth(
          input({ startDate, targetDate, done: 5, total: 10 })
        )
      ).toBe('on-track')
    })

    it('tolerates progress lagging within the slip allowance', () => {
      // elapsed ~0.52, progress 0.4 → 0.4 >= 0.32 → on-track
      expect(
        computeMilestoneHealth(
          input({ startDate, targetDate, done: 4, total: 10 })
        )
      ).toBe('on-track')
    })

    it('does not use start date when target is not after start (falls back to near-deadline)', () => {
      const weird = new Date('2026-05-01T00:00:00Z')
      // start === target, far in the past relative to now but now>target → overdue actually.
      // Use a future target equal to start to exercise the guard:
      const sameFuture = new Date('2026-07-01T00:00:00Z')
      expect(
        computeMilestoneHealth(
          input({
            startDate: sameFuture,
            targetDate: sameFuture,
            done: 0,
            total: 10,
          })
        )
        // target far (>7d), no usable window → near-deadline fallback → on-track
      ).toBe('on-track')
      void weird
    })
  })

  describe('near-deadline fallback (no start date)', () => {
    it('is at-risk when within the near-deadline window with work remaining', () => {
      expect(
        computeMilestoneHealth(
          input({
            startDate: null,
            targetDate: new Date(now.getTime() + 3 * DAY),
            done: 2,
            total: 10,
          })
        )
      ).toBe('at-risk')
    })

    it('treats a deadline (end of target day) exactly NEAR_DEADLINE_DAYS away as at-risk (inclusive)', () => {
      // target + 1 day == the deadline instant; place THAT exactly at the
      // threshold.
      expect(
        computeMilestoneHealth(
          input({
            startDate: null,
            targetDate: new Date(
              now.getTime() + (NEAR_DEADLINE_DAYS - 1) * DAY
            ),
            done: 2,
            total: 10,
          })
        )
      ).toBe('at-risk')
    })

    it('is on-track just outside the near-deadline window (end-of-day reckoning)', () => {
      // Deadline = target + 1 day = 8 days out > NEAR_DEADLINE_DAYS.
      expect(
        computeMilestoneHealth(
          input({
            startDate: null,
            targetDate: new Date(now.getTime() + NEAR_DEADLINE_DAYS * DAY),
            done: 2,
            total: 10,
          })
        )
      ).toBe('on-track')
    })

    it('is on-track when the target is comfortably far away', () => {
      expect(
        computeMilestoneHealth(
          input({
            startDate: null,
            targetDate: new Date(now.getTime() + 30 * DAY),
            done: 0,
            total: 10,
          })
        )
      ).toBe('on-track')
    })
  })

  it('exports tunable thresholds', () => {
    expect(SCHEDULE_SLIP).toBeGreaterThan(0)
    expect(NEAR_DEADLINE_DAYS).toBeGreaterThan(0)
  })

  describe('milestoneHealthFromCounts', () => {
    it('derives done/total from per-status counts', () => {
      const result = milestoneHealthFromCounts(
        {
          completedAt: null,
          archivedAt: null,
          startDate: null,
          targetDate: new Date(now.getTime() + 3 * DAY),
        },
        {
          BACKLOG: 0,
          TODO: 5,
          IN_PROGRESS: 2,
          IN_REVIEW: 1,
          DONE: 2,
          CANCELED: 0,
        },
        now
      )
      // total 10, done 2, target in 3d, no start → near-deadline → at-risk
      expect(result).toBe('at-risk')
    })

    it('reports on-track when every counted task is done', () => {
      const result = milestoneHealthFromCounts(
        {
          completedAt: null,
          archivedAt: null,
          startDate: null,
          targetDate: new Date(now.getTime() + 1 * DAY),
        },
        {
          BACKLOG: 0,
          TODO: 0,
          IN_PROGRESS: 0,
          IN_REVIEW: 0,
          DONE: 4,
          CANCELED: 0,
        },
        now
      )
      expect(result).toBe('on-track')
    })
  })
})
