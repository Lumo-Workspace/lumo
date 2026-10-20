/** @jest-environment jsdom */
/**
 * LUM-712 review follow-up: the Properties / Repos rows had no coverage. The
 * repository writes in particular were only ever exercised by hand.
 */

jest.mock('react-intl', () => {
  const en = require('@/lib/i18n/en.json') as Record<string, string>
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) => {
        let msg = en[id] ?? defaultMessage ?? id
        for (const [k, v] of Object.entries(values ?? {})) {
          msg = msg.split(`{${k}}`).join(String(v))
        }
        return msg
      },
    }),
  }
})

const mockApiFetch = jest.fn()
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

const mockUseGithubRepos = jest.fn()
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useGithubRepos', () => ({
  useGithubRepos: (...args: unknown[]) => mockUseGithubRepos(...args),
}))

// OwnerSelect drags in Radix Select (portals, pointer-capture); the assertions
// here are about the copy it is handed, so a stub keeps them readable.
jest.mock('@/app/workspace/[workspaceUrl]/components/fields', () => ({
  FIELD_TRIGGER_CLS: '',
  OwnerSelect: ({
    value,
    unassignedLabel,
    tooltipText,
    onChange,
  }: {
    value: string | null
    unassignedLabel: string
    tooltipText: string
    onChange: (v: string | null) => void
  }) => (
    <button
      data-testid='owner-select'
      data-tooltip={tooltipText}
      onClick={() => onChange('member-2')}
    >
      {value ?? unassignedLabel}
    </button>
  ),
}))

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProjectPropertyRows } from '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectPropertyRows'
import type { ApiRepository } from '@/app/workspace/[workspaceUrl]/types'

const repo = (id: string, fullName: string, isDefault = false): ApiRepository =>
  ({ id, fullName, name: fullName.split('/')[1], isDefault }) as ApiRepository

function setup(
  repositories: ApiRepository[] | undefined = [
    repo('r1', 'Lumo-Workspace/lumo', true),
  ]
) {
  const onOwnerChange = jest.fn()
  const utils = render(
    <ProjectPropertyRows
      projectId='p1'
      ownerId={null}
      repositories={repositories}
      members={[]}
      workspaceUrl='acme'
      onOwnerChange={onOwnerChange}
    />
  )
  return { ...utils, onOwnerChange }
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockResolvedValue({})
  mockUseGithubRepos.mockReset()
  mockUseGithubRepos.mockReturnValue({
    repos: [],
    loading: false,
    connected: true,
  })
})

describe('ProjectPropertyRows', () => {
  it('renders the owner and repository rows from flat props', () => {
    setup()

    expect(screen.getByText('Properties')).toBeInTheDocument()
    expect(screen.getByText('Repositories')).toBeInTheDocument()
    expect(screen.getByText('Lumo-Workspace/lumo')).toBeInTheDocument()
    // The default repo is marked; the row does not have to be hovered to know.
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('takes its owner copy from the locale file, not a hardcoded string', () => {
    setup()

    const owner = screen.getByTestId('owner-select')
    expect(owner).toHaveTextContent('No owner')
    expect(owner).toHaveAttribute(
      'data-tooltip',
      'Owner — primary contact for this project'
    )
  })

  it('hands an owner change straight back to the caller', () => {
    const { onOwnerChange } = setup()

    fireEvent.click(screen.getByTestId('owner-select'))
    expect(onOwnerChange).toHaveBeenCalledWith('member-2')
  })

  it('promotes a repository to default and marks only that one', async () => {
    setup([
      repo('r1', 'Lumo-Workspace/lumo', true),
      repo('r2', 'Lumo-Workspace/agent', false),
    ])

    fireEvent.click(screen.getByLabelText('Set as default'))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/projects/p1/repositories/r2',
        { method: 'PATCH', body: { isDefault: true } }
      )
    )
    // Exactly one Default marker survives the promotion.
    await waitFor(() => expect(screen.getAllByText('Default')).toHaveLength(1))
  })

  it('unlinks a repository and drops its row', async () => {
    setup([repo('r1', 'Lumo-Workspace/lumo', true)])

    fireEvent.click(screen.getByLabelText('Remove'))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/api/projects/p1/repositories/r1',
        { method: 'DELETE' }
      )
    )
    await waitFor(() =>
      expect(screen.queryByText('Lumo-Workspace/lumo')).not.toBeInTheDocument()
    )
  })

  it('keeps the row when the unlink request fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('boom'))
    setup([repo('r1', 'Lumo-Workspace/lumo', true)])

    fireEvent.click(screen.getByLabelText('Remove'))

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    // A failed delete must not look like a successful one.
    expect(screen.getByText('Lumo-Workspace/lumo')).toBeInTheDocument()
  })

  it('renders the add-repository trigger with no repositories linked', () => {
    setup([])

    expect(screen.getByText('Add repository')).toBeInTheDocument()
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
  })

  it('leaves each repo row a link to GitHub', () => {
    setup()

    const link = screen.getByLabelText('Open on GitHub')
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Lumo-Workspace/lumo'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('only asks GitHub for repositories while the picker is open', () => {
    setup()

    // Gated on the popover being open, so the page does not pay for a repo
    // listing nobody asked for.
    expect(mockUseGithubRepos).toHaveBeenCalledWith('acme', false)
  })

  it('re-syncs when the parent hydrates repositories after first render', () => {
    const { rerender } = render(
      <ProjectPropertyRows
        projectId='p1'
        ownerId={null}
        repositories={undefined}
        members={[]}
        workspaceUrl='acme'
        onOwnerChange={jest.fn()}
      />
    )
    expect(screen.queryByText('Lumo-Workspace/lumo')).not.toBeInTheDocument()

    rerender(
      <ProjectPropertyRows
        projectId='p1'
        ownerId={null}
        repositories={[repo('r1', 'Lumo-Workspace/lumo', true)]}
        members={[]}
        workspaceUrl='acme'
        onOwnerChange={jest.fn()}
      />
    )
    expect(screen.getByText('Lumo-Workspace/lumo')).toBeInTheDocument()
  })
})
