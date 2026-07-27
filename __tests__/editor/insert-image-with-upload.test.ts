import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'
import { uploadImageFile } from '@/lib/editor/image-upload'

jest.mock('@/lib/editor/image-upload', () => ({
  uploadImageFile: jest.fn(),
}))

const mockedUpload = uploadImageFile as jest.MockedFunction<
  typeof uploadImageFile
>

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:fake')
  global.URL.revokeObjectURL = jest.fn()
})

/** Editor stub with an empty doc — descendants never matches, so the swap/
 *  remove loops run without finding a node (safe for these paths). */
function emptyEditorStub() {
  return {
    chain: () => ({
      focus: () => ({
        insertContentAt: () => ({ run: () => true }),
        setImage: () => ({ run: () => true }),
      }),
    }),
    state: { doc: { descendants: () => {} }, tr: {} },
    view: { dispatch: () => {} },
  } as unknown as import('@tiptap/core').Editor
}

it('revokes the object URL and returns when there is no editor', async () => {
  const onError = jest.fn()
  await insertImageWithUpload(
    new File(['x'], 'p', { type: 'image/png' }),
    'doc1',
    () => null,
    undefined,
    onError
  )
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  expect(mockedUpload).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('calls onError and revokes when the upload returns no URL', async () => {
  mockedUpload.mockResolvedValue(null)
  const onError = jest.fn()
  const ed = emptyEditorStub()
  await insertImageWithUpload(
    new File(['x'], 'p', { type: 'image/png' }),
    'doc1',
    () => ed,
    undefined,
    onError
  )
  expect(mockedUpload).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledTimes(1)
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
})

it('does not call onError on a successful upload', async () => {
  mockedUpload.mockResolvedValue('https://cdn/img.png')
  const onError = jest.fn()
  const ed = emptyEditorStub()
  await insertImageWithUpload(
    new File(['x'], 'p', { type: 'image/png' }),
    'doc1',
    () => ed,
    undefined,
    onError
  )
  expect(onError).not.toHaveBeenCalled()
  expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
})
