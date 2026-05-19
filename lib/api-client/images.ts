import { apiFetch } from './base'

interface UploadImageResult {
  url: string
}

export const imagesClient = {
  /**
   * Upload an image file to Vercel Blob via `POST /api/upload/image`.
   * Optionally scopes the upload under a folder (e.g. a documentId).
   * Returns the public CDN URL.
   */
  async upload(file: File, folder?: string): Promise<UploadImageResult> {
    const formData = new FormData()
    formData.set('file', file)
    if (folder) formData.set('folder', folder)
    return apiFetch<UploadImageResult>('/api/upload/image', {
      method: 'POST',
      body: formData,
    })
  },
}
