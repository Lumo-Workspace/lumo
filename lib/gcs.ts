import { Storage } from '@google-cloud/storage'

/**
 * Singleton GCS Storage client.
 * Credentials come from env vars set in .env.local / production env.
 *
 * IMPORTANT: The bucket must have Access Control = Fine-grained (UBLA disabled).
 * If UBLA is enabled, makePublic() will throw a 400 error.
 */
export const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID ?? '',
  credentials: {
    client_email: process.env.GCS_CLIENT_EMAIL ?? '',
    // Service account JSON keys store the PEM key with literal \n characters.
    // In .env files these are stored as backslash-n; replace at runtime.
    private_key: process.env.GCS_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? '',
  },
})

export const logoBucket = storage.bucket(process.env.GCS_BUCKET!)
