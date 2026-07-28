/** @jest-environment jsdom */

// react-intl ships pure ESM and can't be transformed by jest without special config.
// Mock it the same way other component tests in this project do.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { render } from '@testing-library/react'

import { StatusIcon } from '@/app/workspace/[workspaceUrl]/components/StatusIcon'

function renderIcon(status: string) {
  const { container } = render(<StatusIcon status={status} />)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error(`StatusIcon rendered no <svg> for status ${status}`)
  return svg
}

describe('StatusIcon', () => {
  it('renders DONE as a solid filled circle with no check path', () => {
    const svg = renderIcon('DONE')

    const circles = svg.querySelectorAll('circle')
    expect(circles).toHaveLength(1)
    expect(circles[0]?.getAttribute('fill')).toBe('currentColor')
    // The ring statuses carry a stroke; the solid ball must not.
    expect(circles[0]?.getAttribute('stroke')).toBeNull()

    // The white check mark is gone — no path element at all.
    expect(svg.querySelectorAll('path')).toHaveLength(0)

    // Color still flows through the semantic status token.
    expect(svg.getAttribute('class')).toBe('text-status-done')
  })

  it('keeps the ring statuses untouched', () => {
    for (const status of ['TODO', 'IN_PROGRESS', 'IN_REVIEW']) {
      const svg = renderIcon(status)
      const circle = svg.querySelector('circle')
      expect(circle?.getAttribute('stroke')).toBe('currentColor')
      expect(circle?.getAttribute('fill')).toBe('none')
    }
  })

  it('scales every part of the icon with the size prop', () => {
    const { container } = render(<StatusIcon status='DONE' size={28} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('28')
    expect(svg?.querySelector('circle')?.getAttribute('cx')).toBe('14')
  })
})
