jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  workspacesClient: { getMe: jest.fn() },
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import {
  resendErrorMessageId,
  useInvites,
  type EmailField,
} from '@/app/workspace/[workspaceUrl]/hooks/useInvites'

// noUncheckedIndexedAccess makes `arr[i]` possibly-undefined; this asserts
// presence so the tests read the concrete field.
function at(fields: EmailField[], i: number): EmailField {
  const f = fields[i]
  if (!f) throw new Error(`expected an email field at index ${i}`)
  return f
}

let queryClient: QueryClient

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
})

describe('useInvites email fields', () => {
  it('seeds a single empty field with a stable id', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    expect(result.current.emailInputs).toHaveLength(1)
    expect(at(result.current.emailInputs, 0).value).toBe('')
    expect(typeof at(result.current.emailInputs, 0).id).toBe('string')
  })

  it('assigns a unique id to each added field', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    act(() => result.current.addEmailField())
    act(() => result.current.addEmailField())
    const ids = result.current.emailInputs.map(f => f.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('updates a field by id without disturbing others', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    act(() => result.current.addEmailField())
    const a = at(result.current.emailInputs, 0)
    const b = at(result.current.emailInputs, 1)
    act(() => result.current.updateEmail(b.id, 'b@x.com'))
    const byId = Object.fromEntries(
      result.current.emailInputs.map(f => [f.id, f.value])
    )
    expect(byId[a.id]).toBe('')
    expect(byId[b.id]).toBe('b@x.com')
  })

  it('removing a middle field preserves surviving fields ids+values', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    act(() => result.current.addEmailField())
    act(() => result.current.addEmailField())
    // fill all three
    const f0 = at(result.current.emailInputs, 0)
    const f1 = at(result.current.emailInputs, 1)
    const f2 = at(result.current.emailInputs, 2)
    act(() => result.current.updateEmail(f0.id, '0@x.com'))
    act(() => result.current.updateEmail(f1.id, '1@x.com'))
    act(() => result.current.updateEmail(f2.id, '2@x.com'))
    // remove the middle one
    act(() => result.current.removeEmail(f1.id))
    const survivors = result.current.emailInputs
    expect(survivors).toHaveLength(2)
    expect(at(survivors, 0).id).toBe(f0.id)
    expect(at(survivors, 0).value).toBe('0@x.com')
    expect(at(survivors, 1).id).toBe(f2.id)
    expect(at(survivors, 1).value).toBe('2@x.com')
  })

  it('removing the only field reseeds an empty field', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    const onlyId = at(result.current.emailInputs, 0).id
    act(() => result.current.removeEmail(onlyId))
    expect(result.current.emailInputs).toHaveLength(1)
    expect(at(result.current.emailInputs, 0).value).toBe('')
  })

  it('caps fields at 10', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    act(() => {
      for (let n = 0; n < 20; n++) result.current.addEmailField()
    })
    expect(result.current.emailInputs.length).toBe(10)
    expect(new Set(result.current.emailInputs.map(f => f.id)).size).toBe(10)
  })

  it('resetEmails returns to a single empty field', () => {
    const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
    act(() => result.current.addEmailField())
    act(() => result.current.resetEmails())
    expect(result.current.emailInputs).toHaveLength(1)
    expect(at(result.current.emailInputs, 0).value).toBe('')
  })
})

describe('LUM-1017 resend failure messages', () => {
  it('maps the resend route codes to specific messages', () => {
    expect(resendErrorMessageId({ code: 'EMAIL_SEND_FAILED' })).toBe(
      'members.resendEmailFailed'
    )
    expect(resendErrorMessageId({ code: 'EMAIL_NOT_CONFIGURED' })).toBe(
      'members.resendEmailNotConfigured'
    )
    expect(resendErrorMessageId({ code: 'INVITE_NOT_FOUND' })).toBe(
      'members.resendInviteNotFound'
    )
    expect(resendErrorMessageId({ code: 'INVITE_NOT_PENDING' })).toBe(
      'members.resendInviteNotPending'
    )
    for (const generic of ['API_ERROR', 'UNAUTHORIZED', 'INTERNAL_ERROR']) {
      expect(resendErrorMessageId({ code: generic })).toBe(
        'members.resendFailed'
      )
    }
    // prototype keys are not codes
    expect(resendErrorMessageId({ code: 'constructor' })).toBe(
      'members.resendFailed'
    )
    expect(resendErrorMessageId(new Error('boom'))).toBe('members.resendFailed')
    expect(resendErrorMessageId(null)).toBe('members.resendFailed')
  })

  it.each([
    ['EMAIL_SEND_FAILED', 'members.resendEmailFailed'],
    ['EMAIL_NOT_CONFIGURED', 'members.resendEmailNotConfigured'],
  ])(
    'handleResend shows an error toast for %s, not success',
    async (code, id) => {
      ;(apiFetch as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('x'), { status: 502, code })
      )
      const { result } = renderHook(() => useInvites(), { wrapper: Wrapper })
      await act(() => result.current.handleResend('tok-1'))
      expect(toast.error).toHaveBeenCalledWith(id)
      expect(toast.success).not.toHaveBeenCalled()
      expect(result.current.resendingToken).toBeNull()
    }
  )
})
