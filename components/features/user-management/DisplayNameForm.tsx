'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { PROFILE_CONSTANTS } from '@/types/profile'

/**
 * Display name validation schema for form
 */
const displayNameSchema = z
  .string()
  .min(PROFILE_CONSTANTS.DISPLAY_NAME.MIN_LENGTH, 'Display name is too short')
  .max(PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH, 'Display name is too long')
  .regex(
    PROFILE_CONSTANTS.DISPLAY_NAME.ALLOWED_CHARACTERS,
    'Display name contains invalid characters'
  )
  .refine(
    name => name.trim().length > 0,
    'Display name cannot be empty or only whitespace'
  )

const formSchema = z.object({
  displayName: displayNameSchema,
})

type FormData = z.infer<typeof formSchema>

interface DisplayNameFormProps {
  initialDisplayName?: string
  onSuccess?: (displayName: string) => void
  className?: string
}

export function DisplayNameForm({
  initialDisplayName = '',
  onSuccess,
  className,
}: DisplayNameFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: initialDisplayName,
    },
  })

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: data.displayName.trim(),
        }),
      })

      if (response.ok) {
        const updatedProfile = await response.json()
        toast.success('Profile updated', {
          description: 'Your display name has been updated successfully.',
        })
        onSuccess?.(updatedProfile.displayName)
      } else {
        const errorData = await response.json()
        toast.error('Update failed', {
          description: errorData.error || 'Failed to update display name',
        })
      }
    } catch (error) {
      toast.error('Network error', {
        description: 'Please check your connection and try again.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className={className}>
      <div className='space-y-4'>
        <div>
          <Label htmlFor='displayName'>Display Name</Label>
          <Input
            id='displayName'
            {...form.register('displayName')}
            placeholder='Enter your display name'
            disabled={isSubmitting}
            className='mt-1'
          />
          {form.formState.errors.displayName && (
            <p className='text-sm text-red-600 mt-1'>
              {form.formState.errors.displayName.message}
            </p>
          )}
          <p className='text-sm text-gray-500 mt-1'>
            This name will be visible to your team members. Must be between{' '}
            {PROFILE_CONSTANTS.DISPLAY_NAME.MIN_LENGTH} and{' '}
            {PROFILE_CONSTANTS.DISPLAY_NAME.MAX_LENGTH} characters.
          </p>
        </div>

        <Button
          type='submit'
          disabled={isSubmitting || !form.formState.isDirty}
          className='w-full'
        >
          {isSubmitting ? 'Updating...' : 'Update Display Name'}
        </Button>
      </div>
    </form>
  )
}
