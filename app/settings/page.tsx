import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { ProfileSettings } from '@/components/features/user-management/ProfileSettings'

export default async function SettingsPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  return (
    <div className='container mx-auto px-4 py-8 max-w-4xl'>
      <div className='space-y-8'>
        <div>
          <h1 className='text-3xl font-bold text-gray-900'>Account Settings</h1>
          <p className='mt-2 text-gray-600'>
            Manage your account preferences and connected services.
          </p>
        </div>

        {/* Profile Management Section */}
        <ProfileSettings />

        {/* Security & Privacy */}
        <div className='bg-white shadow rounded-lg p-6'>
          <h2 className='text-xl font-semibold text-gray-900 mb-4'>
            Security & Privacy
          </h2>
          <div className='space-y-4'>
            <div className='flex items-center justify-between'>
              <div>
                <h3 className='text-sm font-medium text-gray-900'>
                  Two-Factor Authentication
                </h3>
                <p className='text-sm text-gray-500'>
                  Manage 2FA and security settings in your Clerk account
                </p>
              </div>
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <h3 className='text-sm font-medium text-gray-900'>
                  Data Export
                </h3>
                <p className='text-sm text-gray-500'>
                  Download a copy of your account data
                </p>
              </div>
              <button className='px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2'>
                Export
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
