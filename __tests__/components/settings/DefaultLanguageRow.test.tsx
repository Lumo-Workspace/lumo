/**
 * LUM-1097 — Settings → Workspace → Default language: lists every supported
 * language by its own name, saves only on Save, reports the result, and
 * resets the choice when the server refuses it. The ProjectSlackDialog event
 * labels come from the catalogues too (checked in the slack index test).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DefaultLanguageRow } from '@/app/workspace/[workspaceUrl]/components/settings/DefaultLanguageRow'
import { workspacesClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { PUBLIC_LOCALES, PUBLIC_LOCALE_NAMES } from '@/lib/i18n/public-locale'
import {
  installRadixSelectShims,
  optionNames,
  pickOption,
} from '../../helpers/radix-select'

installRadixSelectShims()

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/zh-CN.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: ({ id }: { id: string }) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return text
      },
    }),
  }
})
jest.mock('@/lib/api-client', () => ({
  workspacesClient: { updateMe: jest.fn() },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const updateMe = workspacesClient.updateMe as jest.Mock

beforeEach(() => jest.clearAllMocks())

it('shows the current language with a translated label and every option', async () => {
  render(<DefaultLanguageRow value='en' onSaved={jest.fn()} />)
  const trigger = screen.getByLabelText('默认语言')
  expect(trigger).toHaveTextContent(PUBLIC_LOCALE_NAMES.en)
  // Nothing changed yet → no Save button.
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  const names = await optionNames(trigger)
  expect(names).toHaveLength(PUBLIC_LOCALES.length)
  expect(names).toContain('简体中文')
})

it('saves the chosen language', async () => {
  updateMe.mockResolvedValue({ workspace: { defaultLocale: 'zh-CN' } })
  const onSaved = jest.fn()
  render(<DefaultLanguageRow value='en' onSaved={onSaved} />)
  await pickOption(screen.getByLabelText('默认语言'), '简体中文')
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('zh-CN'))
  expect(updateMe).toHaveBeenCalledWith({ defaultLocale: 'zh-CN' })
  expect(toast.success).toHaveBeenCalledWith('默认语言已更新')
})

it('a refused save resets the choice and reports the error', async () => {
  updateMe.mockRejectedValue(
    new Error('Only admins can update workspace settings')
  )
  const onSaved = jest.fn()
  render(<DefaultLanguageRow value='fr' onSaved={onSaved} />)
  const trigger = screen.getByLabelText('默认语言')
  await pickOption(trigger, PUBLIC_LOCALE_NAMES.de)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'Only admins can update workspace settings'
    )
  )
  expect(trigger).toHaveTextContent(PUBLIC_LOCALE_NAMES.fr)
  expect(onSaved).not.toHaveBeenCalled()
})

// LUM-1265: the shadcn Select stays keyboard-operable — Enter or Space opens
// it, the arrow keys move between languages, Enter picks.
it.each(['{Enter}', ' '])(
  'opens with %s and picks with the arrows',
  async key => {
    render(<DefaultLanguageRow value='en' onSaved={jest.fn()} />)
    const trigger = screen.getByLabelText('默认语言')
    trigger.focus()
    await userEvent.keyboard(key)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(PUBLIC_LOCALES.length)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    const next = PUBLIC_LOCALES[PUBLIC_LOCALES.indexOf('en') + 1]!
    expect(trigger).toHaveTextContent(PUBLIC_LOCALE_NAMES[next])
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
  }
)
