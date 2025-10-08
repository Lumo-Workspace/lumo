import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-6 sm:px-6 lg:px-8'>
        <div className='px-4 py-6 sm:px-0'>
          <div className='border-4 border-dashed border-gray-200 rounded-lg h-96 flex items-center justify-center'>
            <div className='text-center'>
              <h1 className='text-2xl font-bold text-gray-900 mb-4'>
                Welcome to Lumo AI!
              </h1>
              <p className='text-gray-600 mb-4'>
                Hello, {session.user?.name || session.user?.email}!
              </p>
              <p className='text-sm text-gray-500'>
                You have successfully signed in with Google OAuth.
              </p>
              {session.user?.image && (
                <img
                  src={session.user.image}
                  alt='Profile'
                  className='w-16 h-16 rounded-full mx-auto mt-4'
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
