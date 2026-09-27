/**
 * LUM-855: a redacted detail block renders the not-retained notice with the
 * size of what was dropped — never an empty code block.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
      `${id} ${JSON.stringify(values ?? {})}`,
  }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import { Timeline } from '@/app/sessions/[id]/Timeline'
import { mergeEvents } from '@/app/sessions/[id]/merge-events'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'

describe('session Timeline — redacted content', () => {
  it('shows a not-retained notice with line and byte counts', () => {
    const input = { file_path: '/repo/a.ts', content: 'one\ntwo\nthree' }
    const items = mergeEvents([
      {
        id: 'post',
        type: 'POST_TOOL_USE',
        toolName: 'Write',
        payload: stripCodeFromHookPayload('POST_TOOL_USE', {
          tool_use_id: 'tu_1',
          tool_input: input,
          tool_response: { type: 'create', filePath: '/repo/a.ts' },
        }),
        createdAt: new Date('2026-09-26T10:00:00Z'),
      },
    ])
    render(<Timeline items={items} />)
    fireEvent.click(screen.getByRole('button', { name: /\/repo\/a\.ts/ }))

    expect(
      screen.getByText(
        'sessionTimeline.contentNotRetained {"lines":3,"bytes":13}'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/three/)).not.toBeInTheDocument()
  })
})
