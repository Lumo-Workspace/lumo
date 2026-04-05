import { formatDueDate, isOverdue } from '@/app/workspace/[workspaceUrl]/utils'

describe('formatDueDate', () => {
  it('returns empty string for null', () => {
    expect(formatDueDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatDueDate(undefined)).toBe('')
  })

  it('returns "Today" for today', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(formatDueDate(today.toISOString())).toBe('Today')
  })

  it('returns "Tomorrow" for tomorrow', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    expect(formatDueDate(tomorrow.toISOString())).toBe('Tomorrow')
  })

  it('returns short date for same year', () => {
    const date = new Date()
    date.setMonth(5, 15) // Jun 15
    date.setHours(0, 0, 0, 0)
    const now = new Date()
    if (date.toDateString() === now.toDateString()) return
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (date.toDateString() === tomorrow.toDateString()) return
    expect(formatDueDate(date.toISOString())).toBe('Jun 15')
  })

  it('returns date with year for different year', () => {
    const date = new Date(2028, 2, 21) // Mar 21, 2028
    expect(formatDueDate(date.toISOString())).toBe('Mar 21, 2028')
  })
})

describe('isOverdue', () => {
  it('returns false for null', () => {
    expect(isOverdue(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isOverdue(undefined)).toBe(false)
  })

  it('returns false for today', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    expect(isOverdue(today.toISOString())).toBe(false)
  })

  it('returns false for tomorrow', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    expect(isOverdue(tomorrow.toISOString())).toBe(false)
  })

  it('returns true for yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    expect(isOverdue(yesterday.toISOString())).toBe(true)
  })
})
