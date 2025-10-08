import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { redirect } from 'next/navigation'
import { UserProfile } from '@/components/auth/user-profile'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-6 sm:px-6 lg:px-8'>
        <div className='px-4 py-6 sm:px-0'>
          <div className='mb-8'>
            <h1 className='text-3xl font-bold text-gray-900 mb-2'>
              Welcome to Lumo AI!
            </h1>
            <p className='text-gray-600'>
              Hello, {session.user?.name || session.user?.email}! You have
              successfully signed in with Google OAuth.
            </p>
          </div>

          <div className='grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8'>
            <UserProfile
              session={session}
              showPreferences={true}
              showSettings={true}
              className='h-fit'
            />

            <div className='bg-white rounded-lg shadow p-6'>
              <h2 className='text-xl font-semibold mb-4'>Quick Actions</h2>
              <div className='space-y-3'>
                <Link
                  href='/settings'
                  className='block w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                >
                  Account Settings
                </Link>
                <Link
                  href='/settings'
                  className='block w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                >
                  Manage Account Linking
                </Link>
                <Link
                  href='/app'
                  className='block w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 rounded-md transition-colors'
                >
                  Go to App
                </Link>
              </div>
            </div>
          </div>

          <div className='bg-white rounded-lg shadow p-6'>
            <h2 className='text-xl font-semibold mb-4'>Recent Activity</h2>
            <p className='text-gray-500'>
              Your authentication session is active and secure. Last sign-in:{' '}
              {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
