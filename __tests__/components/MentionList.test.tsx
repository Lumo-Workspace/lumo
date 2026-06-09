/** @jest-environment jsdom */
import en from '@/lib/i18n/en.json'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) =>
      (en as Record<string, string>)[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import {
  MentionList,
  type MentionListRef,
} from '@/app/workspace/[workspaceUrl]/components/MentionList'

function renderList(items: any[], loading = false) {
  return render(
    <MentionList
      ref={createRef<MentionListRef>()}
      items={items}
      loading={loading}
      command={() => {}}
    />
  )
}

it('groups all five kinds under headers', () => {
  renderList([
    { kind: 'user', id: 'u1', label: 'Alice', imageUrl: null },
    {
      kind: 'task',
      id: 't1',
      label: 'LUM-1',
      sublabel: 'Fix',
      status: 'TODO',
      href: '/x',
    },
    { kind: 'sprint', id: 's1', label: 'Sprint 14', href: '/x' },
    { kind: 'project', id: 'p1', label: 'Lumo', href: '/x' },
    { kind: 'milestone', id: 'm1', label: 'v1', href: '/x' },
  ])
  expect(screen.getByText('Users')).toBeInTheDocument()
  expect(screen.getByText('Tasks')).toBeInTheDocument()
  expect(screen.getByText('Sprints')).toBeInTheDocument()
  expect(screen.getByText('Projects')).toBeInTheDocument()
  expect(screen.getByText('Milestones')).toBeInTheDocument()
  expect(screen.getByText('Alice')).toBeInTheDocument()
})

it('shows searching state when loading with no entity items yet', () => {
  renderList([{ kind: 'user', id: 'u1', label: 'Alice', imageUrl: null }], true)
  expect(screen.getByText('Searching…')).toBeInTheDocument()
})

it('shows empty state when no items and not loading', () => {
  renderList([], false)
  expect(screen.getByText('No results')).toBeInTheDocument()
})
