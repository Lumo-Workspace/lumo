jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { formatDate } from '@/app/workspace/[workspaceUrl]/sprints/components/DatePickerField'

test('formatDate honors the timeZone argument', () => {
  // 2026-07-06T05:00:00Z = Jul 5 in LA, Jul 6 in Shanghai
  expect(formatDate('2026-07-06T05:00:00Z', 'en', 'America/Los_Angeles')).toBe(
    'Jul 5, 2026'
  )
  expect(formatDate('2026-07-06T05:00:00Z', 'en', 'Asia/Shanghai')).toBe(
    'Jul 6, 2026'
  )
})
