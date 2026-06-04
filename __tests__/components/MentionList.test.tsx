/** @jest-environment jsdom */
const en: Record<string, string> = {
  'mention.empty': 'No results',
  'mention.users': 'Users',
  'mention.tasks': 'Tasks',
  'mention.label': 'Mention suggestions',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MentionList } from '@/app/workspace/[workspaceUrl]/components/MentionList'
import type {
  MentionItem,
  MentionListRef,
} from '@/app/workspace/[workspaceUrl]/components/MentionList'

const items: MentionItem[] = [
  { type: 'user', id: 'u1', label: 'Alice', imageUrl: null },
  { type: 'user', id: 'u2', label: 'Bob', imageUrl: null },
  { type: 'task', id: 't1', label: 'LUM-1', title: 'Fix bug', status: 'TODO' },
]

describe('MentionList a11y', () => {
  it('exposes a labelled listbox with one option per item', () => {
    render(<MentionList items={items} command={jest.fn()} />)
    const listbox = screen.getByRole('listbox', { name: 'Mention suggestions' })
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('marks the first option selected and points aria-activedescendant at it', () => {
    render(<MentionList items={items} command={jest.fn()} />)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')

    const listbox = screen.getByRole('listbox')
    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[0]!.id)
    expect(options[0]!.id).toBeTruthy()
  })

  it('moves the active option on ArrowDown via the imperative ref', () => {
    const ref = createRef<MentionListRef>()
    render(<MentionList ref={ref} items={items} command={jest.fn()} />)

    let handled = false
    act(() => {
      handled = ref.current!.onKeyDown({
        event: new KeyboardEvent('keydown', { key: 'ArrowDown' }),
      })
    })
    expect(handled).toBe(true)

    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('listbox').getAttribute('aria-activedescendant')).toBe(
      options[1]!.id
    )
  })

  it('groups options by users and tasks', () => {
    render(<MentionList items={items} command={jest.fn()} />)
    expect(screen.getByRole('group', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tasks' })).toBeInTheDocument()
  })
})
