// Consent screen of the self-hosted MCP OAuth authorization server
// (LUM-1044). Better Auth only: under Clerk this route does not exist.
// Signed-in users only — the proxy sends anonymous visitors to /signin.
import { notFound } from 'next/navigation'
import { OAuthConsent } from '@/lib/auth/client'
import { isBetterAuth } from '@/lib/auth/provider'

export const dynamic = 'force-dynamic'

export default function OAuthConsentPage() {
  if (!isBetterAuth()) notFound()
  return (
    <div className='min-h-screen flex items-center justify-center bg-background px-4'>
      <OAuthConsent />
    </div>
  )
}
