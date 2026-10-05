/**
 * LUM-907 follow-up: the logo uploader always shows its own localized error,
 * never the server's raw error text (English, or a bare "Internal Server
 * Error" since the OWNER check moved into the service).
 */
import React from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { toast } from 'sonner'
import en from '@/lib/i18n/en.json'
import { LogoUploader } from '@/components/LogoUploader'

// react-intl ships ESM jest can't load; resolve ids against the real English
// catalogue so the assertions see the copy a user would.
jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: ({ id }: { id: string }) => messages[id] ?? id,
    }),
  }
})
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('react-image-crop/dist/ReactCrop.css', () => ({}), { virtual: true })
jest.mock('react-image-crop', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  centerCrop: (crop: object) => crop,
  makeAspectCrop: () => ({ unit: '%', x: 10, y: 10, width: 80, height: 80 }),
}))

const toastError = toast.error as jest.Mock

beforeAll(() => {
  Object.assign(URL, {
    createObjectURL: jest.fn(() => 'blob:logo'),
    revokeObjectURL: jest.fn(),
  })
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    drawImage: jest.fn(),
  })) as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['x'], { type: 'image/jpeg' }))
  }
})

beforeEach(() => jest.clearAllMocks())

function fakeResponse(status: number, body: object): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

async function saveWith(upload: (fd: FormData) => Promise<Response>) {
  const onUpload = jest.fn()
  const { container } = render(
    <LogoUploader
      currentLogoUrl={null}
      workspaceName='Acme'
      onUpload={onUpload}
      upload={upload}
    />
  )
  const input = container.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'l.png', { type: 'image/png' })] },
  })
  const img = (await screen.findByRole('dialog')).querySelector(
    'img'
  ) as HTMLImageElement
  Object.defineProperty(img, 'naturalWidth', { value: 400 })
  Object.defineProperty(img, 'naturalHeight', { value: 400 })
  fireEvent.load(img)
  fireEvent.click(screen.getByRole('button', { name: en['common.save'] }))
  return onUpload
}

describe('LogoUploader error text', () => {
  it('logo uploader: a 500 shows the localized failure, not Internal Server Error', async () => {
    await saveWith(async () =>
      fakeResponse(500, { error: 'Internal Server Error' })
    )
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(en['logoUploader.uploadFailed'])
    )
    expect(JSON.stringify(toastError.mock.calls)).not.toContain(
      'Internal Server Error'
    )
  })

  it('logo uploader: a 403 or 400 with English server text still shows the localized failure', async () => {
    for (const [status, error] of [
      [403, 'Only owners can change the logo'],
      [400, 'File must be PNG, JPEG, or WebP'],
    ] as const) {
      cleanup()
      toastError.mockClear()
      await saveWith(async () => fakeResponse(status, { error }))
      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(en['logoUploader.uploadFailed'])
      )
      expect(JSON.stringify(toastError.mock.calls)).not.toContain(error)
    }
  })

  it('logo uploader: a network failure shows the localized retry message', async () => {
    await saveWith(async () => {
      throw new TypeError('Failed to fetch')
    })
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(en['logoUploader.uploadRetry'])
    )
    expect(JSON.stringify(toastError.mock.calls)).not.toContain(
      'Failed to fetch'
    )
  })

  it('logo uploader: a successful upload reports the new URL', async () => {
    const onUpload = await saveWith(async () =>
      fakeResponse(200, { logoUrl: 'https://cdn.example.test/logo.jpg' })
    )
    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith('https://cdn.example.test/logo.jpg')
    )
    expect(toastError).not.toHaveBeenCalled()
  })
})
