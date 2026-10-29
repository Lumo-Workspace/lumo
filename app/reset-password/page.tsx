// Forgot / reset password (LUM-1070). Public — a signed-out user requests the
// link, and the link itself lands here. LUM-1082: a 404 when the instance
// turned password sign-in off (AUTH_DISABLE_PASSWORD).
import { notFound } from 'next/navigation'
import { ResetPassword } from '@/lib/auth/client'
import { hasPasswordReset } from '@/lib/auth/provider'

export const dynamic = 'force-dynamic'

export default function ResetPasswordPage() {
  if (!hasPasswordReset()) notFound()
  return (
    <div className='min-h-screen flex items-center justify-center bg-background px-4'>
      <ResetPassword />
    </div>
  )
}
