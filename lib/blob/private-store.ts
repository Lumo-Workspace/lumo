/**
 * LUM-916 — the token of Lumo's PRIVATE Vercel Blob store.
 *
 * Access is a per-STORE setting in Vercel Blob: a public store rejects
 * `access: 'private'` ("Cannot use private access on a public store"). The
 * original store (`BLOB_READ_WRITE_TOKEN`) is public and keeps holding
 * workspace logos; everything private — test evidence, editor images,
 * workspace exports, SARIF uploads — lives in a second store connected with
 * the env prefix `BLOB_PRIVATE`.
 *
 * Every private-blob call passes this token explicitly; without it the SDK
 * would silently fall back to the public store's token and fail at runtime.
 */
export function privateBlobToken(): string {
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'BLOB_PRIVATE_READ_WRITE_TOKEN is not set — private uploads need the private Blob store'
    )
  }
  return token
}
