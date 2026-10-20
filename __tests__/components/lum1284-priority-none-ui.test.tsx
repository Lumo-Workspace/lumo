/** @jest-environment jsdom */
// LUM-1284: a NONE (not assessed) priority reads as "No priority" with a
// neutral hollow ring, never as a coloured level.
const en: Record<string, string> = {
  'task.priority': 'Priority',
  'priority.none': 'No priority',
  'priority.high': 'High',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { PrioritySelect } from '@/app/workspace/[workspaceUrl]/components/fields/PrioritySelect'
import {
  PRIORITY_CONFIG,
  PRIORITY_LABEL_ID,
  PriorityDot,
} from '@/app/workspace/[workspaceUrl]/components/fields/shared'
import enMessages from '@/lib/i18n/en.json'

describe('NONE priority display', () => {
  it('PriorityDot draws NONE as a muted dashed ring, levels as filled discs', () => {
    render(
      <>
        <PriorityDot priority='NONE' />
        <PriorityDot priority='HIGH' />
      </>
    )
    const none = screen.getByTestId('priority-dot-none')
    expect(none.className).toContain('border-dashed')
    expect(none.className).toContain('text-muted-foreground')
    expect(none.className).not.toContain('bg-current')
    expect(screen.getByTestId('priority-dot-high').className).toContain(
      'bg-current'
    )
  })

  it('PrioritySelect shows "No priority" for a NONE task', () => {
    render(<PrioritySelect value='NONE' onChange={jest.fn()} />)
    expect(screen.getByRole('combobox')).toHaveTextContent('No priority')
  })

  it('pickers list NONE last and every label id exists in en.json', () => {
    expect(Object.keys(PRIORITY_CONFIG)).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
      'NONE',
    ])
    for (const id of Object.values(PRIORITY_LABEL_ID))
      expect(enMessages).toHaveProperty([id])
  })
})
