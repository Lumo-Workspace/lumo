import { isWorkStartedStatus } from '@/lib/task/work-started'

describe('isWorkStartedStatus (LUM-437 / LUM-1057)', () => {
  it('treats BACKLOG and TODO as not started', () => {
    expect(isWorkStartedStatus('BACKLOG')).toBe(false)
    expect(isWorkStartedStatus('TODO')).toBe(false)
  })

  it('treats every later status as started', () => {
    expect(isWorkStartedStatus('IN_PROGRESS')).toBe(true)
    expect(isWorkStartedStatus('IN_REVIEW')).toBe(true)
    expect(isWorkStartedStatus('DONE')).toBe(true)
  })
})
