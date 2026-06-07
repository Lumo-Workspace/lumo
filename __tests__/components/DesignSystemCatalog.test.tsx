/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

import { DesignSystemCatalog } from '@/components/design-system/DesignSystemCatalog'

// next-themes needs no provider if we stub useTheme.
jest.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: jest.fn() }),
}))

describe('DesignSystemCatalog', () => {
  it('renders the catalog with every section heading', () => {
    render(<DesignSystemCatalog />)
    for (const title of [
      'Color tokens',
      'Typography',
      'Elevation & radius',
      'Motion',
      'Spacing & control sizes',
      'Button',
      'Badge',
      'Form fields',
      'Status & priority',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
  })

  it('renders real component variants', () => {
    render(<DesignSystemCatalog />)
    // Button section renders multiple "Button" labels; Badge renders "Badge".
    expect(screen.getAllByRole('button', { name: 'Button' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Badge').length).toBeGreaterThan(0)
  })
})
