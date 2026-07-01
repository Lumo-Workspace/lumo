import {
  isValidTimeZone,
  zonedWeekday,
  zonedMidnight,
  addZonedDays,
  nextZonedWeekdayMidnight,
} from '@/lib/datetime/timezone'

describe('timezone utils', () => {
  test('isValidTimeZone accepts IANA, rejects junk', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Phobos')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  test('zonedWeekday reads weekday in the target zone', () => {
    // 2026-06-29 07:00 UTC = Mon in LA (00:00 PDT) and Mon in Shanghai (15:00)
    const d = new Date('2026-06-29T07:00:00Z')
    expect(zonedWeekday(d, 'America/Los_Angeles')).toBe(1) // Mon
    // 2026-06-29 02:00 UTC = Sun 19:00 in LA
    const e = new Date('2026-06-29T02:00:00Z')
    expect(zonedWeekday(e, 'America/Los_Angeles')).toBe(0) // Sun
  })

  test('zonedMidnight returns the UTC instant of local 00:00', () => {
    // Any instant on 2026-06-29 (LA) floors to 2026-06-29T07:00:00Z (PDT = UTC-7)
    const d = new Date('2026-06-29T18:30:00Z')
    expect(zonedMidnight(d, 'America/Los_Angeles').toISOString()).toBe(
      '2026-06-29T07:00:00.000Z'
    )
    // Shanghai is UTC+8 year-round
    expect(zonedMidnight(d, 'Asia/Shanghai').toISOString()).toBe(
      '2026-06-29T16:00:00.000Z'
    )
  })

  test('addZonedDays stays on local midnight across a DST spring-forward', () => {
    // US DST spring-forward 2026 is Sun 2026-03-08. Start Sat 2026-03-07 LA midnight.
    const sat = zonedMidnight(
      new Date('2026-03-07T12:00:00Z'),
      'America/Los_Angeles'
    )
    // +2 calendar days = Mon 2026-03-09 local midnight (07:00Z, now PDT = UTC-7)
    const mon = addZonedDays(sat, 2, 'America/Los_Angeles')
    expect(mon.toISOString()).toBe('2026-03-09T07:00:00.000Z')
    expect(zonedWeekday(mon, 'America/Los_Angeles')).toBe(1)
  })

  test('nextZonedWeekdayMidnight finds the next weekday at local midnight', () => {
    // from Wed 2026-07-01 (LA). Next Monday (1) is 2026-07-06 local midnight.
    const from = new Date('2026-07-01T18:00:00Z')
    const mon = nextZonedWeekdayMidnight(from, 1, 'America/Los_Angeles')
    expect(mon.toISOString()).toBe('2026-07-06T07:00:00.000Z')
    // If `from` is already that weekday's local midnight, return same day.
    const alreadyMon = zonedMidnight(
      new Date('2026-07-06T12:00:00Z'),
      'America/Los_Angeles'
    )
    expect(
      nextZonedWeekdayMidnight(
        alreadyMon,
        1,
        'America/Los_Angeles'
      ).toISOString()
    ).toBe('2026-07-06T07:00:00.000Z')
  })
})
