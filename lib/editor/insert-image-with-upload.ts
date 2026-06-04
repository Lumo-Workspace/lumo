import type { Editor } from '@tiptap/core'
import { uploadImageFile } from './image-upload'

/**
 * Insert an image immediately using a local blob URL for instant preview,
 * upload in the background, then swap the src to the real CDN URL when done.
 * On failure, removes the placeholder and invokes `onError` (the caller owns
 * any user-facing toast — this module stays UI-free).
 *
 * Returns a Promise that resolves when the upload is settled (success or fail),
 * so callers can track pending uploads before committing the document.
 */
export async function insertImageWithUpload(
  file: File,
  documentId: string | undefined,
  getEditor: () => Editor | null,
  insertPos: number | undefined,
  onError: () => void
): Promise<void> {
  const tempUrl = URL.createObjectURL(file)
  const ed = getEditor()
  if (!ed) {
    URL.revokeObjectURL(tempUrl)
    return
  }

  // Show the image immediately with the local blob URL
  if (insertPos !== undefined) {
    ed.chain()
      .focus()
      .insertContentAt(insertPos, { type: 'image', attrs: { src: tempUrl } })
      .run()
  } else {
    ed.chain().focus().setImage({ src: tempUrl }).run()
  }

  try {
    const realUrl = await uploadImageFile(file, documentId)
    if (!realUrl) throw new Error('Upload returned no URL')

    // Swap blob URL → CDN URL in the document
    const current = getEditor()
    if (current) {
      let swapped = false
      current.state.doc.descendants((node, pos) => {
        if (swapped) return false
        if (node.type.name === 'image' && node.attrs.src === tempUrl) {
          const tr = current.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            src: realUrl,
          })
          current.view.dispatch(tr)
          swapped = true
          return false
        }
        return true
      })
    }
  } catch {
    // Remove the broken placeholder image
    const current = getEditor()
    if (current) {
      let removed = false
      current.state.doc.descendants((node, pos) => {
        if (removed) return false
        if (node.type.name === 'image' && node.attrs.src === tempUrl) {
          const tr = current.state.tr.delete(pos, pos + node.nodeSize)
          current.view.dispatch(tr)
          removed = true
          return false
        }
        return true
      })
    }
    onError()
  } finally {
    URL.revokeObjectURL(tempUrl)
  }
}
