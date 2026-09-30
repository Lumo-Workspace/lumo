import { apiFetch } from './base'

interface UploadImageResult {
  url: string
}

export const imagesClient = {
  /**
   * Upload an image file via `POST /api/upload/image`. Returns Lumo's
   * authenticated file-route URL (LUM-916 — the blob itself is private).
   * `folder` is ignored by the server since LUM-916 (it picks the
   * workspace prefix); kept so older callers keep compiling.
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
