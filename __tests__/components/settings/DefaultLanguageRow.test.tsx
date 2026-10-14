/**
 * LUM-1097 — Settings → Workspace → Default language: lists every supported
 * language by its own name, saves only on Save, reports the result, and
 * resets the choice when the server refuses it. The ProjectSlackDialog event
 * labels come from the catalogues too (checked in the slack index test).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DefaultLanguageRow } from '@/app/workspace/[workspaceUrl]/components/settings/DefaultLanguageRow'
import { workspacesClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'

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

it('shows the current language with a translated label and every option', () => {
  render(<DefaultLanguageRow value='en' onSaved={jest.fn()} />)
  const select = screen.getByLabelText('默认语言') as HTMLSelectElement
  expect(select.value).toBe('en')
  expect(select.options).toHaveLength(PUBLIC_LOCALES.length)
  expect(screen.getByRole('option', { name: '简体中文' })).toBeTruthy()
  // Nothing changed yet → no Save button.
  expect(screen.queryByRole('button')).toBeNull()
})

it('saves the chosen language', async () => {
  updateMe.mockResolvedValue({ workspace: { defaultLocale: 'zh-CN' } })
  const onSaved = jest.fn()
  render(<DefaultLanguageRow value='en' onSaved={onSaved} />)
  fireEvent.change(screen.getByLabelText('默认语言'), {
    target: { value: 'zh-CN' },
  })
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
  const select = screen.getByLabelText('默认语言') as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'de' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'Only admins can update workspace settings'
    )
  )
  expect(select.value).toBe('fr')
  expect(onSaved).not.toHaveBeenCalled()
})
