'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function SignupPage() {
  return (
    <div className='min-h-screen bg-gradient-to-br from-purple-50 via-white to-purple-50 flex items-center justify-center p-4'>
      <div className='w-full max-w-md'>
        {/* Back to Home Link */}
        <div className='mb-6'>
          <Link
            href='/'
            className='inline-flex items-center text-gray-600 hover:text-purple-600 transition-colors'
          >
            <ArrowLeft className='w-4 h-4 mr-2' />
            Back to Home
          </Link>
        </div>

        {/* Signup Card */}
        <Card className='shadow-xl border-0 bg-white/80 backdrop-blur-sm'>
          <CardHeader className='text-center pb-8'>
            <div className='w-16 h-16 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center mb-4 mx-auto shadow-lg'>
              <svg
                className='w-8 h-8 text-white'
                fill='currentColor'
                viewBox='0 0 24 24'
              >
                <path d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' />
              </svg>
            </div>
            <CardTitle className='text-2xl font-bold text-gray-900'>
              Create Account
            </CardTitle>
            <CardDescription className='text-gray-600'>
              Join Lumo and start managing your projects today
            </CardDescription>
          </CardHeader>

          <CardContent className='space-y-6'>
            {/* Google Signup Button */}
            <Button
              variant='outline'
              className='w-full h-12 border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all duration-300 text-gray-700 hover:text-gray-800'
              onClick={() => {
                // Handle Google signup here
                // TODO: Implement Google OAuth
              }}
            >
              <svg className='w-5 h-5 mr-2' viewBox='0 0 24 24'>
                <path
                  fill='#4285F4'
                  d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z'
                />
                <path
                  fill='#34A853'
                  d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z'
                />
                <path
                  fill='#FBBC05'
                  d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z'
                />
                <path
                  fill='#EA4335'
                  d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z'
                />
              </svg>
              Continue with Google
            </Button>

            {/* Sign In Link */}
            <div className='text-center'>
              <p className='text-sm text-gray-600'>
                Already have an account?{' '}
                <Link
                  href='/login'
                  className='text-purple-600 hover:text-purple-700 font-medium transition-colors'
                >
                  Sign in here
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
