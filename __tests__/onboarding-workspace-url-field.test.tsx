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
import { renderToString } from 'react-dom/server'
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

  describe('workspace URL prefix (LUM-1028)', () => {
    const original = process.env.NEXT_PUBLIC_APP_URL
    afterEach(() => {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL
      else process.env.NEXT_PUBLIC_APP_URL = original
    })

    const renderPrefix = () => {
      const { container } = render(<OnboardingClient />)
      return {
        container,
        prefix:
          container.querySelector('#ws-url')?.previousElementSibling
            ?.textContent,
      }
    }

    it('keeps the hosted prefix for https://www.uselumo.ai', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://www.uselumo.ai'
      const { container, prefix } = renderPrefix()
      expect(prefix).toBe('uselumo.ai/workspace/')
      expect(container.textContent).not.toContain('lumo.app/')
    })

    it('shows a self-hosted instance its own address', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
      expect(renderPrefix().prefix).toBe('localhost:3000/workspace/')
    })

    it('falls back to the browser host when the app URL is unset or invalid', () => {
      delete process.env.NEXT_PUBLIC_APP_URL
      expect(renderPrefix().prefix).toBe(`${window.location.host}/workspace/`)
      process.env.NEXT_PUBLIC_APP_URL = 'not a url'
      expect(renderPrefix().prefix).toBe(`${window.location.host}/workspace/`)
    })

    // renderToString uses the server snapshot, so this is what the HTML holds
    // before hydration — it must never be the browser host.
    const serverPrefix = () => {
      const doc = new DOMParser().parseFromString(
        renderToString(<OnboardingClient />),
        'text/html'
      )
      return doc.querySelector('#ws-url')?.previousElementSibling?.textContent
    }

    it('renders the configured prefix on the server', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
      expect(serverPrefix()).toBe('localhost:3000/workspace/')
    })

    it('renders the bare fallback on the server when the app URL is unset', () => {
      delete process.env.NEXT_PUBLIC_APP_URL
      expect(serverPrefix()).toBe('/workspace/')
    })
  })

  it('runs the prefix straight into the slug with no divider or gap', () => {
    const { container } = render(<OnboardingClient />)
    const input = container.querySelector('#ws-url') as HTMLElement
    const prefix = input.previousElementSibling as HTMLElement
    const prefixClasses = prefix.className.split(/\s+/)
    const inputClasses = input.className.split(/\s+/)
    for (const c of ['px-3', 'pr-3', 'border-r', 'bg-muted']) {
      expect(prefixClasses).not.toContain(c)
    }
    expect(inputClasses).toContain('pl-0')
    expect(inputClasses).not.toContain('px-3')
  })
})
