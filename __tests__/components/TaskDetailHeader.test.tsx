/** @jest-environment jsdom */
// LUM-203: icon-only buttons (more-options, copy-link) had no accessible name,
// so screen readers announced them as bare "button". These tests pin an
// aria-label sourced from react-intl onto each.
const en: Record<string, string> = {
  'task.moreOptions': 'More options',
  'task.copyLink': 'Copy link',
  'task.deleteTask': 'Delete task',
  'task.deleteTitle': 'Delete task?',
  'task.deleteDesc': 'Delete {title}?',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, string>
    ) => {
      const msg = en[id] ?? id
      return values
        ? msg.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? `{${k}}`)
        : msg
    },
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

import { render, screen } from '@testing-library/react'
import { TaskDetailHeader } from '@/app/workspace/[workspaceUrl]/components/TaskDetailHeader'

function renderHeader(
  props: Partial<React.ComponentProps<typeof TaskDetailHeader>> = {}
) {
  return render(
    <TaskDetailHeader
      workspaceUrl='acme'
      from={null}
      sourceLabel='Project'
      taskTitle='Fix the thing'
      taskIdentifier='LUM-203'
      projectName='Lumo'
      deleteOpen={false}
      setDeleteOpen={jest.fn()}
      onDeleteTask={jest.fn()}
      taskLinkCopied={false}
      onCopyTaskLink={jest.fn()}
      {...props}
    />
  )
}

describe('TaskDetailHeader a11y', () => {
  it('gives the more-options button an accessible label', () => {
    renderHeader()
    expect(
      screen.getByRole('button', { name: 'More options' })
    ).toBeInTheDocument()
  })

  it('gives the copy-link button an accessible label', () => {
    renderHeader()
    expect(
      screen.getByRole('button', { name: 'Copy link' })
    ).toBeInTheDocument()
  })
})
