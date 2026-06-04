import { renderHook, act, waitFor } from '@testing-library/react'
import { useImageUploads } from '@/app/workspace/[workspaceUrl]/hooks/useImageUploads'
import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'
import { toast } from 'sonner'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/lib/editor/insert-image-with-upload', () => ({
  insertImageWithUpload: jest.fn(),
}))

const mockedInsert = insertImageWithUpload as jest.MockedFunction<
  typeof insertImageWithUpload
>
const mockedToastError = toast.error as jest.MockedFunction<typeof toast.error>

function pngOfSize(bytes: number): File {
  const f = new File(['x'], 'p', { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

function setup(documentId = 'doc1') {
  const editorRef = { current: null }
  return renderHook(() => useImageUploads({ editorRef, documentId }))
}

beforeEach(() => jest.clearAllMocks())

it('rejects an oversized file with a toast and does not upload', () => {
  mockedInsert.mockResolvedValue(undefined)
  const { result } = setup()
  act(() => {
    result.current.enqueueImageUpload(pngOfSize(20 * 1024 * 1024))
  })
  expect(mockedToastError).toHaveBeenCalledWith('task.imageTooLarge')
  expect(mockedInsert).not.toHaveBeenCalled()
})

it('rejects a disallowed type with a toast and does not upload', () => {
  mockedInsert.mockResolvedValue(undefined)
  const { result } = setup()
  const bmp = new File(['x'], 'p', { type: 'image/bmp' })
  act(() => {
    result.current.enqueueImageUpload(bmp)
  })
  expect(mockedToastError).toHaveBeenCalledWith('task.imageInvalidType')
  expect(mockedInsert).not.toHaveBeenCalled()
})

it('enqueues a valid file through insertImageWithUpload', () => {
  mockedInsert.mockResolvedValue(undefined)
  const { result } = setup()
  act(() => {
    result.current.enqueueImageUpload(pngOfSize(1024))
  })
  expect(mockedInsert).toHaveBeenCalledTimes(1)
})

it('runs the commit immediately when no uploads are in flight', () => {
  const { result } = setup()
  const commit = jest.fn()
  act(() => {
    result.current.runOrDeferCommit(commit)
  })
  expect(commit).toHaveBeenCalledTimes(1)
})

it('defers the commit until an in-flight upload settles', async () => {
  let resolveUpload: () => void = () => {}
  mockedInsert.mockImplementation(
    () => new Promise<void>(r => { resolveUpload = () => r() })
  )
  const { result } = setup()
  const commit = jest.fn()

  act(() => {
    result.current.enqueueImageUpload(pngOfSize(1024))
  })
  act(() => {
    result.current.runOrDeferCommit(commit)
  })
  expect(commit).not.toHaveBeenCalled()

  await act(async () => {
    resolveUpload()
  })
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
})
