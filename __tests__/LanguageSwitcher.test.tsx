import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import {
  SUPPORTED_LOCALES,
  QUICK_SWITCH_LOCALES,
  resolveLocale,
  withCurrentLocale,
} from '@/lib/i18n/locales'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

jest.mock('@/components/ui/select', () => {
  const React = require('react')
  return {
    Select: ({ value, onValueChange, disabled, children }: any) =>
      React.createElement(
        'select',
        {
          'data-testid': 'language-select',
          value,
          disabled,
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

describe('LanguageSwitcher', () => {
  it('offers the quick-switch subset by default', () => {
    render(<LanguageSwitcher value='en' onChange={jest.fn()} />)
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(o => o.value)).toEqual(
      QUICK_SWITCH_LOCALES.map(o => o.value)
    )
  })

  it('renders every locale it is given, labelled in that language', () => {
    render(
      <LanguageSwitcher
        value='en'
        onChange={jest.fn()}
        options={SUPPORTED_LOCALES}
      />
    )
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map(o => o.value)).toEqual(
      SUPPORTED_LOCALES.map(o => o.value)
    )
    // Endonyms, not English names — a picker must stay readable to someone
    // who cannot read the language currently rendering.
    expect(options.map(o => o.textContent)).toEqual(
      SUPPORTED_LOCALES.map(o => o.label)
    )
  })

  it('reports the picked locale to its parent', () => {
    const onChange = jest.fn()
    render(<LanguageSwitcher value='en' onChange={onChange} />)
    fireEvent.change(screen.getByTestId('language-select'), {
      target: { value: 'zh-CN' },
    })
    expect(onChange).toHaveBeenCalledWith('zh-CN')
  })

  it('neither reads nor writes preferences itself', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/LanguageSwitcher.tsx'),
      'utf8'
    )
    expect(src).not.toMatch(/usePreferences|apiFetch|fetch\(/)
  })

  it('honours disabled', () => {
    render(<LanguageSwitcher value='en' onChange={jest.fn()} disabled />)
    expect(screen.getByTestId('language-select')).toBeDisabled()
  })
})

describe('locale option list is single-sourced', () => {
  it('lists exactly the locales that have a message catalogue', () => {
    const files = readdirSync(join(process.cwd(), 'lib/i18n'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
    // es.json is the catalogue backing the 'es-ES' option; every other file
    // maps to an option of the same name.
    const expected = files.map(f => (f === 'es' ? 'es-ES' : f)).sort()
    expect(SUPPORTED_LOCALES.map(o => o.value).sort()).toEqual(expected)
  })

  it('keeps the quick-switch subset inside the supported set', () => {
    const supported = SUPPORTED_LOCALES.map(o => o.value)
    for (const option of QUICK_SWITCH_LOCALES) {
      expect(supported).toContain(option.value)
      expect(option.label).toBeTruthy()
    }
  })

  it('has no second copy of the list in any switcher', () => {
    // The drift this guards: a locale added here but not there, so the two
    // switchers disagree about what the app supports.
    for (const file of [
      'app/workspace/[workspaceUrl]/components/pages/PreferencesPage.tsx',
      'app/workspace/[workspaceUrl]/components/pages/project-detail/ProjectHeader.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8')
      expect(src).not.toMatch(/SelectItem value='(en|zh-CN|fr|ja)'/)
    }
  })

  it('shows a current locale that sits outside the quick-switch subset', () => {
    // A French viewer must see "Français" on the trigger, not a blank one.
    render(<LanguageSwitcher value='fr' onChange={jest.fn()} />)
    const select = screen.getByTestId('language-select')
    expect(select).toHaveValue('fr')
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument()
  })

  it('adds the current locale to the options only when it is missing and supported', () => {
    expect(withCurrentLocale(QUICK_SWITCH_LOCALES, 'en')).toBe(
      QUICK_SWITCH_LOCALES
    )
    expect(
      withCurrentLocale(QUICK_SWITCH_LOCALES, 'ja').map(o => o.value)
    ).toEqual([...QUICK_SWITCH_LOCALES.map(o => o.value), 'ja'])
    expect(withCurrentLocale(QUICK_SWITCH_LOCALES, 'kl')).toBe(
      QUICK_SWITCH_LOCALES
    )
  })

  it('falls back to English for unknown and legacy values', () => {
    expect(resolveLocale('zh')).toBe('zh-CN') // pre-split Chinese
    expect(resolveLocale('kl')).toBe('en')
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('zh-CN')).toBe('zh-CN')
  })
})
