import { redirect } from 'next/navigation'

/**
 * Legacy login page — redirects to Clerk sign-in.
 */
export default function LoginPage() {
  redirect('/sign-in')
}
