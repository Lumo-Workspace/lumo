import { render } from '@testing-library/react'
import { CiIcon } from '@/app/workspace/[workspaceUrl]/components/pr-helpers'

describe('CiIcon', () => {
  it.each([
    ['success', 'lucide-circle-check'],
    ['failure', 'lucide-circle-x'],
    ['pending', 'lucide-loader-circle'],
  ])('renders an icon for status=%s', (status, iconClass) => {
    const { container } = render(<CiIcon status={status} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('class')).toContain(iconClass)
  })

  it.each([null, 'unknown', ''])(
    'renders a width-reserving placeholder for status=%s',
    status => {
      const { container } = render(<CiIcon status={status} />)
      const child = container.firstElementChild as HTMLElement | null
      expect(child).not.toBeNull()
      expect(child?.tagName).toBe('SPAN')
      expect(child?.className).toContain('w-[13px]')
      expect(child?.className).toContain('shrink-0')
    }
  )
})
