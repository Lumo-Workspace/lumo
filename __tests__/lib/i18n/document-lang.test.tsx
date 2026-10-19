/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react'
import { useIntl } from 'react-intl'
import { IntlProviderWrapper } from '@/lib/i18n/IntlProviderWrapper'

// react-intl ships pure ESM that jest can't transform here; a context-backed
// stand-in is enough to observe which locale the wrapper resolved.
jest.mock('react-intl', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const Ctx = React.createContext('none')
  return {
    IntlProvider: ({
      locale,
      children,
    }: {
      locale: string
      children: React.ReactNode
    }) => React.createElement(Ctx.Provider, { value: locale }, children),
    useIntl: () => ({ locale: React.useContext(Ctx) }),
  }
})

// LUM-1261: <html lang> follows the active UI locale so the browser picks the
// right CJK glyph forms and screen readers announce the right language.

function ActiveLocale() {
  return <span data-testid='locale'>{useIntl().locale}</span>
}

/** Mirrors the app: root Providers' `en` wrapper around a localized subtree. */
function App({ locale }: { locale: string }) {
  return (
    <IntlProviderWrapper locale='en'>
      <IntlProviderWrapper locale={locale}>
        <ActiveLocale />
      </IntlProviderWrapper>
    </IntlProviderWrapper>
  )
}

beforeEach(() => {
  document.documentElement.lang = 'en'
})

describe('IntlProviderWrapper → <html lang>', () => {
  it.each(['ja', 'zh-TW', 'zh-CN', 'ko', 'en-GB', 'es-419'])(
    'a nested wrapper sets lang=%s (the root en wrapper does not override it)',
    locale => {
      render(<App locale={locale} />)
      expect(document.documentElement.lang).toBe(locale)
    }
  )

  it('maps the legacy zh preference to zh-CN', () => {
    render(<App locale='zh' />)
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('falls back to en for an unknown locale', () => {
    document.documentElement.lang = 'en'
    const { getByTestId } = render(<App locale='xx' />)
    expect(getByTestId('locale').textContent).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('follows a locale change and restores the previous lang on unmount', () => {
    const { rerender, unmount } = render(<App locale='ja' />)
    rerender(<App locale='ko' />)
    expect(document.documentElement.lang).toBe('ko')
    unmount()
    expect(document.documentElement.lang).toBe('en')
  })

  it('a lone root wrapper leaves the server-rendered lang alone', () => {
    document.documentElement.lang = 'en'
    render(
      <IntlProviderWrapper locale='ja'>
        <ActiveLocale />
      </IntlProviderWrapper>
    )
    expect(document.documentElement.lang).toBe('en')
  })
})
