/** @jest-environment jsdom */

// LUM-1005: the Workspace URL field wrapper hardcoded `bg-white`, so it
// rendered as a white box in dark mode. It must use the same surface tokens
// as components/ui/input.tsx. Its prefix also showed a non-existent
// `lumo.app/` domain instead of the real workspace URL.

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt: string }) => <img alt={props.alt} />,
}))

import { render } from '@testing-library/react'
import { OnboardingClient } from '@/app/onboarding/OnboardingClient'

describe('onboarding workspace URL field', () => {
  it('uses theme surface tokens instead of a hardcoded white background', () => {
    const { container } = render(<OnboardingClient />)
    const wrapper = container.querySelector('#ws-url')?.parentElement
    expect(wrapper).toBeTruthy()
    const classes = wrapper!.className.split(/\s+/)
    expect(classes).not.toContain('bg-white')
    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-transparent',
        'dark:bg-input/30',
        'focus-within:ring-2',
        'focus-within:ring-ring',
      ])
    )
  })

  it('prefixes the slug with the real workspace URL', () => {
    const { container } = render(<OnboardingClient />)
    const prefix = container.querySelector('#ws-url')?.previousElementSibling
    expect(prefix?.textContent).toBe('uselumo.ai/workspace/')
    expect(container.textContent).not.toContain('lumo.app/')
  })
})
