// Consent screen of the MCP OAuth authorization server (LUM-1044).
// Signed-in users only — the proxy sends anonymous visitors to /signin.
import { OAuthConsent } from '@/lib/auth/client'

export const dynamic = 'force-dynamic'

export default function OAuthConsentPage() {
  return (
    <div className='min-h-screen flex items-center justify-center bg-background px-4'>
      <OAuthConsent />
    </div>
  )
}
