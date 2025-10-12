'use client'

import { useOptimistic } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// Types for our data
interface User {
  id: string
  name: string
  email: string
  createdAt: Date
}

// Optimistic update function
function optimisticUserUpdate(
  users: User[],
  newUser: Omit<User, 'id' | 'createdAt'>
): User[] {
  const optimisticUser: User = {
    id: 'temp-' + Math.random().toString(36).substr(2, 9),
    ...newUser,
    createdAt: new Date(),
  }
  return [...users, optimisticUser]
}

// Component demonstrating useOptimistic hook
export function OptimisticUserList() {
  const [users, setUsers] = useOptimistic<
    User[],
    Omit<User, 'id' | 'createdAt'>
  >(
    [], // Initial state
    optimisticUserUpdate // Optimistic update function
  )

  const handleAddUser = async (formData: FormData) => {
    const name = formData.get('name') as string
    const email = formData.get('email') as string

    // Optimistic update
    setUsers({ name, email })

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000))

    // In a real app, you'd handle the actual API response here
    // and potentially revert the optimistic update if it fails
  }

  return (
    <Card className='w-full max-w-md mx-auto'>
      <CardHeader>
        <CardTitle>Optimistic Updates</CardTitle>
        <CardDescription>Using React 19 useOptimistic hook</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleAddUser} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='optimistic-name'>Name</Label>
            <Input
              id='optimistic-name'
              name='name'
              placeholder='Enter your name'
              required
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='optimistic-email'>Email</Label>
            <Input
              id='optimistic-email'
              name='email'
              type='email'
              placeholder='Enter your email'
              required
            />
          </div>

          <Button type='submit' className='w-full'>
            Add User (Optimistic)
          </Button>
        </form>

        <div className='mt-6'>
          <h3 className='font-medium mb-3'>Users ({users.length})</h3>
          <div className='space-y-2 max-h-40 overflow-y-auto'>
            {users.map(user => (
              <div
                key={user.id}
                className={`p-2 rounded border ${
                  user.id.startsWith('temp-')
                    ? 'bg-blue-50 border-blue-200 opacity-70'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className='font-medium'>{user.name}</div>
                <div className='text-sm text-gray-600'>{user.email}</div>
                {user.id.startsWith('temp-') && (
                  <div className='text-xs text-blue-600 mt-1'>Adding...</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
