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
  'task.showProperties': 'Show properties',
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

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// PageBreadcrumb renders a SidebarTrigger that needs SidebarProvider; stub it
// to its two slots so the header's own content can be asserted.
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children, actions }: any) => (
    <div>
      <div data-testid='breadcrumb-main'>{children}</div>
      <div data-testid='breadcrumb-actions'>{actions}</div>
    </div>
  ),
}))

import { render, screen, fireEvent, within } from '@testing-library/react'
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

// LUM-1274: breadcrumb (source › task id) + tooltip'd ghost icon actions.
describe('TaskDetailHeader layout (LUM-1274)', () => {
  beforeEach(() => mockPush.mockClear())

  it('renders source › task id as a breadcrumb with the id as the current page', () => {
    renderHeader()
    const main = screen.getByTestId('breadcrumb-main')
    expect(within(main).getByRole('navigation')).toHaveAttribute(
      'aria-label',
      'breadcrumb'
    )
    expect(within(main).getByText('LUM-203')).toHaveAttribute(
      'aria-current',
      'page'
    )
    // The title moved into the page body; the bar no longer repeats it.
    expect(within(main).queryByText('Fix the thing')).toBeNull()
  })

  it('navigates back to the source when the first crumb is clicked', () => {
    renderHeader({ from: 'my-tasks', sourceLabel: 'My Tasks' })
    fireEvent.click(screen.getByRole('button', { name: 'My Tasks' }))
    expect(mockPush).toHaveBeenCalledWith('/workspace/acme/my-tasks')
  })

  it('offers a properties button only when the page passes a handler', () => {
    const onOpenProperties = jest.fn()
    const { rerender } = renderHeader()
    expect(screen.queryByRole('button', { name: 'Show properties' })).toBeNull()
    rerender(
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
        onOpenProperties={onOpenProperties}
      />
    )
    const btn = screen.getByRole('button', { name: 'Show properties' })
    // Hidden from lg up, where the property rail is inline.
    expect(btn.className).toContain('lg:hidden')
    fireEvent.click(btn)
    expect(onOpenProperties).toHaveBeenCalledTimes(1)
  })
})
