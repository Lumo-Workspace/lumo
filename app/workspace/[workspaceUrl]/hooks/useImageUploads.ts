import { useCallback, useRef, type MutableRefObject } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import type { Editor } from '@tiptap/core'
import { validateImageFile } from '@/lib/editor/image-upload'
import { insertImageWithUpload } from '@/lib/editor/insert-image-with-upload'

interface UseImageUploadsArgs {
  editorRef: MutableRefObject<Editor | null>
  documentId: string | undefined
}

interface UseImageUploadsResult {
  /** Validate + enqueue an upload. Stable across documentId/message changes so
   *  the editor's once-built handlePaste never calls a stale version. */
  enqueueImageUpload: (file: File, insertPos?: number) => void
  /** Run `commit` now, or defer it until all in-flight uploads settle. */
  runOrDeferCommit: (commit: () => void) => void
}

export function useImageUploads({
  editorRef,
  documentId,
}: UseImageUploadsArgs): UseImageUploadsResult {
  const intl = useIntl()
  const imageUploadFailedMsg = intl.formatMessage({
    id: 'task.imageUploadFailed',
  })
  const imageTooLargeMsg = intl.formatMessage({ id: 'task.imageTooLarge' })
  const imageInvalidTypeMsg = intl.formatMessage({
    id: 'task.imageInvalidType',
  })

  // Track in-flight uploads so we can delay a commit until all are settled.
  const pendingUploadsRef = useRef(0)
  const pendingCommitRef = useRef<(() => void) | null>(null)

  // The single place that counts an in-flight upload and runs a deferred
  // commit once the count returns to zero.
  const trackUpload = useCallback((promise: Promise<void>) => {
    pendingUploadsRef.current++
    promise.finally(() => {
      pendingUploadsRef.current--
      if (pendingUploadsRef.current === 0 && pendingCommitRef.current) {
        pendingCommitRef.current()
        pendingCommitRef.current = null
      }
    })
  }, [])

  const enqueueImpl = useCallback(
    (file: File, insertPos?: number) => {
      const check = validateImageFile(file)
      if (!check.ok) {
        toast.error(
          check.reason === 'size' ? imageTooLargeMsg : imageInvalidTypeMsg
        )
        return
      }
      trackUpload(
        insertImageWithUpload(
          file,
          documentId,
          () => editorRef.current,
          insertPos,
          () => toast.error(imageUploadFailedMsg)
        )
      )
    },
    [
      documentId,
      imageUploadFailedMsg,
      imageTooLargeMsg,
      imageInvalidTypeMsg,
      trackUpload,
      editorRef,
    ]
  )

  // Keep the latest impl in a ref and return a referentially-stable wrapper so
  // the editor's frozen handlePaste always reaches the current closure.
  const enqueueImplRef = useRef(enqueueImpl)
  enqueueImplRef.current = enqueueImpl
  const enqueueImageUpload = useCallback(
    (file: File, insertPos?: number) => enqueueImplRef.current(file, insertPos),
    []
  )

  const runOrDeferCommit = useCallback((commit: () => void) => {
    if (pendingUploadsRef.current > 0) {
      pendingCommitRef.current = commit
    } else {
      commit()
    }
  }, [])

  return { enqueueImageUpload, runOrDeferCommit }
}
