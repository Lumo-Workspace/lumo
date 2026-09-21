import {
  render,
  screen,
  fireEvent,
  renderHook,
  act,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectHeader } from '@/app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectHeader'
import { usePreferences } from '@/app/workspace/[workspaceUrl]/hooks/usePreferences'

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn().mockResolvedValue({}),
}))
jest.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: jest.fn() }),
}))
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}))

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

jest.mock('@/components/ui/select', () => {
  const React = require('react')
  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(
        'select',
        {
          'data-testid': 'language-select',
          value,
          onChange: (e: any) => onValueChange(e.target.value),
        },
        children
      ),
    SelectTrigger: ({ children }: any) => children,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => children,
    SelectItem: ({ value, children }: any) =>
      React.createElement('option', { value }, children),
  }
})

/** PageBreadcrumb, reduced to the thing under test: the right-aligned slot. */
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ children, actions }: any) => (
    <div>
      <div data-testid='breadcrumb-main'>{children}</div>
      <div data-testid='breadcrumb-actions'>{actions}</div>
    </div>
  ),
}))

const baseProps = {
  projectId: 'p1',
  projectName: 'Lumo',
  onBack: jest.fn(),
  onDeleteProject: jest.fn(),
}

describe('project header language switcher persists the locale preference', () => {
  it('renders the switcher in the header actions slot, not beside the breadcrumb', () => {
    render(
      <ProjectHeader {...baseProps} locale='en' onLocaleChange={jest.fn()} />
    )
    const actions = screen.getByTestId('breadcrumb-actions')
    expect(actions).toContainElement(screen.getByTestId('language-select'))
    expect(screen.getByTestId('breadcrumb-main')).not.toContainElement(
      screen.getByTestId('language-select')
    )
  })

  it('shows the locale the viewer currently has', () => {
    render(
      <ProjectHeader {...baseProps} locale='zh-CN' onLocaleChange={jest.fn()} />
    )
    expect(screen.getByTestId('language-select')).toHaveValue('zh-CN')
  })

  it('hands a picked locale to the page so it is written to preferences', () => {
    const onLocaleChange = jest.fn()
    render(
      <ProjectHeader
        {...baseProps}
        locale='en'
        onLocaleChange={onLocaleChange}
      />
    )
    fireEvent.change(screen.getByTestId('language-select'), {
      target: { value: 'zh-CN' },
    })
    expect(onLocaleChange).toHaveBeenCalledWith('zh-CN')
  })

  it('does not write the preference itself', () => {
    const src = require('node:fs').readFileSync(
      'app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectHeader.tsx',
      'utf8'
    )
    expect(src).not.toMatch(/usePreferences/)
  })
})

/**
 * The half of "survives a reload" that lives below the header: a picked locale
 * must reach the persisted preference, not just component state. The header
 * hands the value up; this is what the page does with it.
 */
describe('project header language switcher persists the locale preference — storage', () => {
  beforeEach(() => localStorage.clear())

  it('writes the new locale to the preference cache a reload reads from', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => usePreferences(), { wrapper })

    await act(async () => {
      await result.current.updatePreferences({ locale: 'zh-CN' })
    })

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('lumo:preferences') ?? '{}'
      )
      expect(stored.locale).toBe('zh-CN')
    })
  })
})
