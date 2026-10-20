import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer'
import { TaskDrawer } from '@/app/workspace/[workspaceUrl]/components/TaskDrawer'
import type { ApiTask } from '@/app/workspace/[workspaceUrl]/types'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: (d: { id: string }) => d.id }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ workspaceUrl: 'acme' }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/TaskDetailPanel', () => ({
  TaskDetailPanel: () => <div data-testid='task-detail-panel' />,
}))

// LUM-1271: components/ui/drawer.tsx is the in-repo vaul wrapper; TaskDrawer
// depends on it instead of vaul directly.
describe('Drawer primitive', () => {
  it('renders overlay at z-overlay and content at z-modal in the given direction', () => {
    render(
      <Drawer open direction='right'>
        <DrawerContent>
          <DrawerTitle>Title</DrawerTitle>
          <DrawerDescription>Body</DrawerDescription>
        </DrawerContent>
      </Drawer>
    )
    const overlay = document.querySelector('[data-slot="drawer-overlay"]')
    const content = document.querySelector('[data-slot="drawer-content"]')
    expect(overlay).toHaveClass('z-overlay', 'bg-black/50')
    expect(content).toHaveClass('z-modal')
    expect(content).toHaveAttribute('data-vaul-drawer-direction', 'right')
    expect(document.querySelector('.z-50')).toBeNull()
    expect(screen.getByText('Title')).toHaveAttribute(
      'data-slot',
      'drawer-title'
    )
  })
})

describe('TaskDrawer on the Drawer primitive', () => {
  const task = {
    id: 't1',
    title: 'T',
    status: 'TODO',
    priority: 'MEDIUM',
    projectId: 'p1',
    assigneeActorId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    viewOrder: null,
    number: 7,
    teamIdentifier: 'LUM',
  } as unknown as ApiTask

  function renderDrawer(onClose: () => void) {
    return render(
      <TaskDrawer
        initialTask={task}
        onClose={onClose}
        members={[]}
        projects={[]}
        source='my-tasks'
        onUpdate={async () => {}}
      />
    )
  }

  it('keeps the right-side direction and the 520px width override', () => {
    renderDrawer(jest.fn())
    const content = document.querySelector('[data-slot="drawer-content"]')
    expect(content).toHaveAttribute('data-vaul-drawer-direction', 'right')
    expect(content?.className).toContain(
      'data-[vaul-drawer-direction=right]:md:w-[520px]'
    )
    expect(screen.getByTestId('task-detail-panel')).toBeInTheDocument()
  })

  it('closes on an overlay press even though vaul dismissal is off', async () => {
    const onClose = jest.fn()
    renderDrawer(onClose)
    const overlay = document.querySelector(
      '[data-slot="drawer-overlay"]'
    ) as HTMLElement
    // Radix arms its outside-pointer listener on the next tick.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    fireEvent.pointerDown(overlay)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = jest.fn()
    renderDrawer(onClose)
    const content = document.querySelector(
      '[data-slot="drawer-content"]'
    ) as HTMLElement
    fireEvent.keyDown(content, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
