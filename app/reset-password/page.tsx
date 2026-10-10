// Forgot / reset password (LUM-1070). Better Auth only: under Clerk the route
// does not exist (Clerk hosts its own reset flow). Public — a signed-out user
// requests the link, and the link itself lands here.
import { notFound } from 'next/navigation'
import { ResetPassword } from '@/lib/auth/client'
import { isBetterAuth } from '@/lib/auth/provider'

export const dynamic = 'force-dynamic'

export default function ResetPasswordPage() {
  if (!isBetterAuth()) notFound()
  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted px-4'>
      <ResetPassword />
    </div>
  )
}
