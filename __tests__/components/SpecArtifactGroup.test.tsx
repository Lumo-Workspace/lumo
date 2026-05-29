/** @jest-environment jsdom */

/**
 * Mock react-intl to avoid the untranspiled-ESM transform issue under jest
 * (react-intl ships ESM and next/jest excludes node_modules from transform),
 * matching the convention used by the sibling Link*Popover tests.
 * formatMessage returns the message id so intl-driven copy never collides with
 * the artifact title/kind text the assertions target (the group label "Spec"
 * would otherwise clash with the "Spec" artifact title).
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { render, screen, fireEvent } from '@testing-library/react'
import { SpecArtifactGroup } from '@/app/workspace/[workspaceUrl]/components/SpecArtifactGroup'

function renderWithIntl(ui: React.ReactElement) {
  return render(ui)
}

const artifacts = [
  {
    id: 'a1',
    kind: 'spec',
    title: 'Spec',
    content: 'body one',
    source: 'superpowers',
    agent: 'CLAUDE_CODE',
    order: 0,
  },
  {
    id: 'a2',
    kind: 'plan',
    title: 'Plan',
    content: 'body two',
    source: 'superpowers',
    agent: 'CODEX',
    order: 1,
  },
]

describe('SpecArtifactGroup', () => {
  it('renders nothing when there are no artifacts', () => {
    const { container } = renderWithIntl(
      <SpecArtifactGroup taskId='t1' artifacts={[]} onChanged={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one row per artifact with its kind + title', () => {
    renderWithIntl(
      <SpecArtifactGroup
        taskId='t1'
        artifacts={artifacts as any}
        onChanged={() => {}}
      />
    )
    expect(screen.getByText('Spec')).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('spec')).toBeInTheDocument()
  })

  it('expands a row on click to reveal content', () => {
    renderWithIntl(
      <SpecArtifactGroup
        taskId='t1'
        artifacts={artifacts as any}
        onChanged={() => {}}
      />
    )
    expect(screen.queryByText('body one')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Spec'))
    expect(screen.getByText('body one')).toBeInTheDocument()
  })
})
