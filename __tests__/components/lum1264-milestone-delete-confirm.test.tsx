/** @jest-environment jsdom */
/**
 * LUM-1264 — deleting a milestone (from the project's milestone list and from
 * the milestone detail page) confirms through an AlertDialog.
 */
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
          messages[id] ?? id
        ),
    }),
  }
})

const mockDelete = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/api-client', () => ({
  milestonesClient: {
    delete: (...args: unknown[]) => mockDelete(...args),
    update: jest.fn(),
  },
}))

// Run the mutationFn synchronously so the test sees the client call.
jest.mock('@tanstack/react-query', () => ({
  useMutation: (opts: { mutationFn: (v?: unknown) => unknown }) => ({
    mutate: (v?: unknown) => opts.mutationFn(v),
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({
    workspaceUrl: 'acme',
    projectSlug: 'lumo',
    milestoneId: 'cmabcdefghijklmnopqrstuvw',
  }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

const milestone = {
  id: 'ms-1',
  projectId: 'p-1',
  name: 'Beta',
  slug: 'beta',
  description: null,
  startDate: null,
  targetDate: null,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCounts: { BACKLOG: 0, TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 1 },
}

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [milestone], loading: false }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestone', () => ({
  useMilestone: () => ({ milestone, loading: false }),
  useMilestoneByProjectAndSlug: () => ({ milestone, loading: false }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMilestoneArchive', () => ({
  useMilestoneArchive: () => ({
    archive: { mutate: jest.fn(), isPending: false },
    unarchive: { mutate: jest.fn(), isPending: false },
  }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useProjects', () => ({
  useProjects: () => ({ projects: [{ id: 'p-1', name: 'Lumo' }] }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useMembers', () => ({
  useMembers: () => ({ members: [] }),
}))

// Menus and layout chrome have their own suites; stub to a delete trigger.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneRow',
  () => ({
    MilestoneRow: ({ onDelete }: { onDelete: () => void }) => (
      <button type='button' onClick={onDelete}>
        delete-trigger
      </button>
    ),
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneActionsMenu',
  () => ({
    MilestoneActionsMenu: ({ onDelete }: { onDelete: () => void }) => (
      <button type='button' onClick={onDelete}>
        delete-trigger
      </button>
    ),
  })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneFormDialog',
  () => ({ MilestoneFormDialog: () => null })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/DetailLayout', () => ({
  DetailLayout: ({ breadcrumb }: { breadcrumb: React.ReactNode }) => (
    <div>{breadcrumb}</div>
  ),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneBreadcrumb',
  () => ({ MilestoneBreadcrumb: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneSidebar',
  () => ({ MilestoneSidebar: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/milestones/MilestoneDetailBody',
  () => ({ MilestoneDetailBody: () => null })
)

import { ProjectMilestonesTab } from '@/app/workspace/[workspaceUrl]/components/milestones/ProjectMilestonesTab'
import { MilestoneDetailPage } from '@/app/workspace/[workspaceUrl]/components/pages/MilestoneDetailPage'

beforeEach(() => mockDelete.mockClear())

describe.each([
  [
    'ProjectMilestonesTab',
    () => <ProjectMilestonesTab projectId='p-1' projectSlug='lumo' />,
  ],
  ['MilestoneDetailPage', () => <MilestoneDetailPage />],
])('%s delete confirmation', (_name, ui) => {
  function setup() {
    render(ui())
    fireEvent.click(screen.getByText('delete-trigger'))
  }

  it('names the milestone and cancel keeps it', () => {
    setup()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete milestone')
    expect(dialog).toHaveTextContent('"Beta"')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('confirm deletes the milestone', () => {
    setup()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm.className).toMatch(/bg-destructive/)
    fireEvent.click(confirm)
    expect(mockDelete).toHaveBeenCalledWith('ms-1')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
