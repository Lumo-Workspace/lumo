import {
  authService,
  type VerifyApiKeyResult,
} from '@/lib/services/auth.service'

export async function verifyBearer(
  request: Request
): Promise<VerifyApiKeyResult | null> {
  const header = request.headers.get('Authorization')
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null
  return authService.verifyApiKey(token)
}
