import { SignIn } from '@/lib/auth/client'

export default function SignInPage() {
  return (
    <div className='min-h-screen flex items-center justify-center bg-background'>
      <SignIn />
    </div>
  )
}
