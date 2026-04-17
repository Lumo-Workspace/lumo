import { copyLink } from '@/lib/utils/copyLink'
import { toast } from 'sonner'

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

describe('copyLink', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn(),
      },
    })
  })

  it('writes the URL to the clipboard', async () => {
    ;(navigator.clipboard.writeText as jest.Mock).mockResolvedValue(undefined)
    await copyLink('https://example.com/foo')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.com/foo'
    )
  })

  it('shows a success toast on resolve', async () => {
    ;(navigator.clipboard.writeText as jest.Mock).mockResolvedValue(undefined)
    await copyLink('https://example.com')
    expect(toast.success).toHaveBeenCalledWith('Link copied')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows an error toast on reject', async () => {
    ;(navigator.clipboard.writeText as jest.Mock).mockRejectedValue(
      new Error('nope')
    )
    await copyLink('https://example.com')
    expect(toast.error).toHaveBeenCalledWith('Failed to copy link')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
