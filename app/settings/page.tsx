import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth/config'
import AccountLinking from '@/components/features/user-management/auth/account-linking'
import { UserProfile } from '@/components/features/user-management/auth/user-profile'
import { ProfileSettings } from '@/components/features/user-management/ProfileSettings'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
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

        <div className='grid gap-8 md:grid-cols-2'>
          {/* User Profile Section */}
          <div className='space-y-6'>
            <div className='bg-white shadow rounded-lg p-6'>
              <h2 className='text-xl font-semibold text-gray-900 mb-4'>
                Profile Information
              </h2>
              <UserProfile />
            </div>
          </div>

          {/* Account Linking Section */}
          <div className='space-y-6'>
            <div className='bg-white shadow rounded-lg p-6'>
              <h2 className='text-xl font-semibold text-gray-900 mb-4'>
                Connected Accounts
              </h2>
              <AccountLinking />
            </div>
          </div>
        </div>

        {/* Additional Settings */}
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
                  Add an extra layer of security to your account
                </p>
              </div>
              <button className='px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'>
                Enable
              </button>
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <h3 className='text-sm font-medium text-gray-900'>
                  Login Notifications
                </h3>
                <p className='text-sm text-gray-500'>
                  Get notified when someone signs in to your account
                </p>
              </div>
              <button className='px-4 py-2 text-sm font-medium text-green-600 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2'>
                Enabled
              </button>
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

            <div className='flex items-center justify-between'>
              <div>
                <h3 className='text-sm font-medium text-gray-900'>
                  Delete Account
                </h3>
                <p className='text-sm text-gray-500'>
                  Permanently delete your account and all data
                </p>
              </div>
              <button className='px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2'>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
