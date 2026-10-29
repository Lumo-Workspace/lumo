/** @jest-environment jsdom */
/**
 * LUM-1062 — client UI slots (RFC LUM-1058 §3.4 UI 插槽): a slot renders
 * each installed plugin's component in order, the task dossier merges every
 * plugin's contribution in one pass, and with no plugin nothing renders.
 * (Which slots the installed security plugin fills: the plugin half,
 * __tests__/ee/security/components/plugins/client-slots-installed.test.ts —
 * LUM-1065.)
 */
// react-intl ships ESM only; slot components may import it.
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  PluginSlot,
  hasPluginSlot,
  PluginTaskDossier,
  type LumoClientPlugin,
  type MergedDossierContribution,
} from '@/lib/plugins/client'

const badgePlugin = (id: string): LumoClientPlugin => ({
  id,
  slots: {
    'task.pullRequest.badge': ({ pullRequestId }) => (
      <span data-testid={`badge-${id}`}>{pullRequestId}</span>
    ),
  },
})

const dossierPlugin = (
  id: string,
  blocking: number,
  checked: boolean
): LumoClientPlugin => ({
  id,
  slots: {
    'task.dossier': ({ taskId, expanded, onToggle, children }) => (
      <>
        {children({
          blocking,
          checked,
          needsAction: <p data-testid={`needs-${id}`}>{taskId}</p>,
          record: (
            <button
              data-testid={`record-${id}`}
              data-expanded={String(expanded)}
              onClick={onToggle}
            />
          ),
        })}
      </>
    ),
  },
})

function Merged({ merged }: { merged: MergedDossierContribution }) {
  return (
    <div
      data-testid='merged'
      data-present={String(merged.present)}
      data-blocking={merged.blocking}
      data-checked={String(merged.checked)}
    >
      {merged.needsAction}
      {merged.records}
    </div>
  )
}

function dossier(
  plugins: readonly LumoClientPlugin[],
  expanded: string[] = []
) {
  const onToggle = jest.fn()
  render(
    <PluginTaskDossier
      taskId='t1'
      plugins={plugins}
      isExpanded={id => expanded.includes(id)}
      onToggle={onToggle}
    >
      {(merged): ReactNode => <Merged merged={merged} />}
    </PluginTaskDossier>
  )
  return { onToggle, merged: screen.getByTestId('merged') }
}

describe('PluginSlot', () => {
  it('renders each installed component in order with the slot props', () => {
    const { container } = render(
      <PluginSlot
        name='task.pullRequest.badge'
        props={{ taskId: 't1', pullRequestId: 'pr1' }}
        plugins={[
          badgePlugin('a'),
          { id: 'none', slots: {} },
          badgePlugin('b'),
        ]}
      />
    )
    expect(
      [...container.querySelectorAll('span')].map(s => s.dataset.testid)
    ).toEqual(['badge-a', 'badge-b'])
    expect(screen.getByTestId('badge-a')).toHaveTextContent('pr1')
  })

  it('renders nothing without a plugin', () => {
    const { container } = render(
      <PluginSlot
        name='task.pullRequest.badge'
        props={{ taskId: 't1', pullRequestId: 'pr1' }}
        plugins={[]}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})

// LUM-1339: the Code review nav group and pages need the plugin.
describe('hasPluginSlot', () => {
  it('is true only when an installed plugin fills the slot', () => {
    const plugins = [badgePlugin('a')]
    expect(hasPluginSlot('task.pullRequest.badge', plugins)).toBe(true)
    expect(hasPluginSlot('settings.codeReview.behavior', plugins)).toBe(false)
    expect(hasPluginSlot('task.pullRequest.badge', [])).toBe(false)
  })
})

describe('PluginTaskDossier', () => {
  it('without a plugin: nothing present, nothing blocks, no rows', () => {
    const { merged } = dossier([])
    expect(merged.dataset.present).toBe('false')
    expect(merged.dataset.blocking).toBe('0')
    expect(merged.dataset.checked).toBe('false')
    expect(merged).toBeEmptyDOMElement()
  })

  it('sums blocking, ORs checked and keeps every row, in order', () => {
    const { merged, onToggle } = dossier(
      [dossierPlugin('a', 1, false), dossierPlugin('b', 2, true)],
      ['b']
    )
    expect(merged.dataset.present).toBe('true')
    expect(merged.dataset.blocking).toBe('3')
    expect(merged.dataset.checked).toBe('true')
    expect(screen.getByTestId('needs-a')).toHaveTextContent('t1')
    expect(screen.getByTestId('record-a').dataset.expanded).toBe('false')
    expect(screen.getByTestId('record-b').dataset.expanded).toBe('true')
    screen.getByTestId('record-b').click()
    expect(onToggle).toHaveBeenCalledWith('b')
  })
})
