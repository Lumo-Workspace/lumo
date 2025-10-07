'use client'

import { useActionState } from 'react'
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
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

// Types for our form actions
interface User {
  id: string
  name: string
  email: string
  createdAt: Date
}

interface ActionState {
  success: boolean
  message: string
  user?: User
  errors?: Record<string, string[]>
}

// Server action simulation (in a real app, this would be a server action)
async function createUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000))

  const name = formData.get('name') as string
  const email = formData.get('email') as string

  // Validation
  const errors: Record<string, string[]> = {}

  if (!name || name.length < 2) {
    errors.name = ['Name must be at least 2 characters']
  }

  if (!email || !email.includes('@')) {
    errors.email = ['Please enter a valid email address']
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      message: 'Please fix the errors below',
      errors,
    }
  }

  // Simulate successful creation
  const user: User = {
    id: Math.random().toString(36).substr(2, 9),
    name,
    email,
    createdAt: new Date(),
  }

  return {
    success: true,
    message: 'User created successfully!',
    user,
  }
}

// React 19 Actions Form Component
export function UserFormWithActions() {
  const [state, formAction, isPending] = useActionState(createUserAction, {
    success: false,
    message: '',
  })

  return (
    <Card className='w-full max-w-md mx-auto'>
      <CardHeader>
        <CardTitle>Create User</CardTitle>
        <CardDescription>
          Using React 19 Actions with useActionState
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='name'>Name</Label>
            <Input
              id='name'
              name='name'
              placeholder='Enter your name'
              disabled={isPending}
              className={state.errors?.name ? 'border-red-500' : ''}
            />
            {state.errors?.name && (
              <p className='text-sm text-red-500'>{state.errors.name[0]}</p>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='email'>Email</Label>
            <Input
              id='email'
              name='email'
              type='email'
              placeholder='Enter your email'
              disabled={isPending}
              className={state.errors?.email ? 'border-red-500' : ''}
            />
            {state.errors?.email && (
              <p className='text-sm text-red-500'>{state.errors.email[0]}</p>
            )}
          </div>

          <Button type='submit' disabled={isPending} className='w-full'>
            {isPending ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Creating...
              </>
            ) : (
              'Create User'
            )}
          </Button>

          {state.message && (
            <div
              className={`flex items-center gap-2 p-3 rounded-md ${
                state.success
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {state.success ? (
                <CheckCircle className='h-4 w-4' />
              ) : (
                <XCircle className='h-4 w-4' />
              )}
              <span className='text-sm'>{state.message}</span>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
