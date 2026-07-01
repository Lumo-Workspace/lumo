jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { formatDueLabel } from '@/app/workspace/[workspaceUrl]/components/fields/DueDatePicker'

test('formatDueLabel renders the due day in the provided timezone', () => {
  // 2026-07-06T05:00:00Z = Jul 5 in LA, Jul 6 in Shanghai
  expect(
    formatDueLabel('2026-07-06T05:00:00Z', 'en', 'America/Los_Angeles')
  ).toContain('Jul')
  expect(
    formatDueLabel('2026-07-06T05:00:00Z', 'en', 'America/Los_Angeles')
  ).toContain('5')
  expect(
    formatDueLabel('2026-07-06T05:00:00Z', 'en', 'Asia/Shanghai')
  ).toContain('6')
})

test('formatDueLabel falls back to the runtime local zone when timeZone is omitted', () => {
  expect(formatDueLabel('2026-07-06T05:00:00Z', 'en')).toBe(
    formatDueLabel('2026-07-06T05:00:00Z', 'en', undefined)
  )
})
