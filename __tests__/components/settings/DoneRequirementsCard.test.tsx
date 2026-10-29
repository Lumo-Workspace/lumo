/**
 * LUM-1334 — Settings → Workspace → Done requirements: two switches, off by
 * default, each saved the moment it flips (only its own column) and flipped
 * back when the server refuses.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DoneRequirementsCard } from '@/app/workspace/[workspaceUrl]/components/settings/DoneRequirementsCard'
import { workspacesClient } from '@/lib/api-client'
import { toast } from 'sonner'

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

it('shows both switches, off when not loaded, with translated labels', () => {
  render(<DoneRequirementsCard testCase={null} review={null} />)
  expect(screen.getByLabelText('要求通过的测试用例')).toHaveAttribute(
    'aria-checked',
    'false'
  )
  expect(screen.getByLabelText('要求 review')).toHaveAttribute(
    'aria-checked',
    'false'
  )
})

it('saves only the switch that flipped', async () => {
  updateMe.mockResolvedValue({ workspace: {} })
  render(<DoneRequirementsCard testCase={false} review={true} />)
  await userEvent.click(screen.getByLabelText('要求通过的测试用例'))
  await waitFor(() => expect(toast.success).toHaveBeenCalled())
  expect(updateMe).toHaveBeenCalledTimes(1)
  expect(updateMe).toHaveBeenCalledWith({ doneRequiresTestCase: true })
  expect(screen.getByLabelText('要求通过的测试用例')).toHaveAttribute(
    'aria-checked',
    'true'
  )
})

it('flips back and reports when the server refuses', async () => {
  updateMe.mockRejectedValue(
    new Error('Only admins can update workspace settings')
  )
  render(<DoneRequirementsCard testCase={false} review={true} />)
  await userEvent.click(screen.getByLabelText('要求 review'))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      'Only admins can update workspace settings'
    )
  )
  expect(updateMe).toHaveBeenCalledWith({ doneRequiresReview: false })
  expect(screen.getByLabelText('要求 review')).toHaveAttribute(
    'aria-checked',
    'true'
  )
})
