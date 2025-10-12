'use client'

import { UserFormWithActions } from '@/components/core/forms/UserFormActions'
import { OptimisticUserList } from '@/components/features/user-management/OptimisticUserList'

// Demo page showing both patterns
export default function ActionsDemoPage() {
  return (
    <div className='min-h-screen bg-gray-50 py-8'>
      <div className='max-w-4xl mx-auto px-4'>
        <div className='text-center mb-8'>
          <h1 className='text-3xl font-bold text-gray-900 mb-2'>
            React 19 Actions Demo
          </h1>
          <p className='text-gray-600'>
            Demonstrating useActionState and useOptimistic hooks
          </p>
        </div>

        <div className='grid md:grid-cols-2 gap-8'>
          <UserFormWithActions />
          <OptimisticUserList />
        </div>
      </div>
    </div>
  )
}
