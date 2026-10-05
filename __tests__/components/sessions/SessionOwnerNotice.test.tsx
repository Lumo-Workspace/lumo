/** @jest-environment jsdom */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      d: { id?: string; defaultMessage?: string },
      values?: Record<string, string | number>
    ) => {
      let s = d.defaultMessage ?? d.id ?? ''
      for (const [k, v] of Object.entries(values ?? {})) {
        s = s.split(`{${k}}`).join(String(v))
      }
      return s
    },
  }),
}))

import { render, screen } from '@testing-library/react'
import { SessionOwnerNotice } from '@/app/sessions/[id]/SessionOwnerNotice'

describe('SessionOwnerNotice (LUM-946)', () => {
  it('names whose session the owner is viewing', () => {
    render(<SessionOwnerNotice ownerName='Mia Member' />)
    expect(screen.getByRole('note')).toHaveTextContent(
      "This is Mia Member's session."
    )
  })

  it('falls back to another member when the name is unknown', () => {
    render(<SessionOwnerNotice ownerName={null} />)
    expect(screen.getByRole('note')).toHaveTextContent(
      "This is another member's session."
    )
  })
})
