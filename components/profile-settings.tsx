'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AvatarDisplay } from '@/components/avatar-display'
import { AvatarUpload } from '@/components/avatar-upload'
import { DisplayNameForm } from '@/components/display-name-form'
import { useToast } from '@/hooks/use-toast'
import { UserProfile } from '@/types/profile'

interface ProfileSettingsProps {
  className?: string
}

export function ProfileSettings({ className }: ProfileSettingsProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading] = useState(false)
  const { toast } = useToast()

  // Load user profile
  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    try {
      const response = await fetch('/api/profile')
      if (response.ok) {
        const profileData = await response.json()
        setProfile(profileData)
      } else {
        toast({
          title: 'Failed to load profile',
          description: 'Please refresh the page and try again.',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Network error',
        description: 'Please check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisplayNameSuccess = (newDisplayName: string) => {
    if (profile) {
      setProfile({
        ...profile,
        displayName: newDisplayName,
        updatedAt: new Date(),
      })
    }
  }

  const handleAvatarUploadSuccess = (avatarUrl: string) => {
    if (profile) {
      setProfile({
        ...profile,
        avatarUrl,
        updatedAt: new Date(),
      })
    }
  }

  const handleAvatarRemoveSuccess = () => {
    if (profile) {
      setProfile({
        ...profile,
        avatarUrl: null,
        avatarBlobId: null,
        updatedAt: new Date(),
      })
    }
  }

  if (isLoading) {
    return (
      <div className={className}>
        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>Loading your profile...</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='animate-pulse space-y-4'>
              <div className='h-20 w-20 bg-gray-200 rounded-full'></div>
              <div className='h-4 bg-gray-200 rounded w-1/2'></div>
              <div className='h-10 bg-gray-200 rounded'></div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className={className}>
        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>Unable to load your profile</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={loadProfile} variant='outline'>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
          <CardDescription>
            Manage your display name and profile picture
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Avatar Section */}
          <div className='space-y-4'>
            <div className='flex items-center space-x-4'>
              <AvatarDisplay
                avatarUrl={profile.avatarUrl}
                displayName={profile.displayName}
                fallbackName={profile.email}
                userId={profile.id}
                size='xl'
                showTooltip
              />
              <div>
                <h3 className='text-sm font-medium text-gray-900'>
                  Profile Picture
                </h3>
                <p className='text-sm text-gray-500'>
                  Upload a new avatar or remove the current one
                </p>
              </div>
            </div>

            <AvatarUpload
              currentAvatarUrl={profile.avatarUrl}
              onUploadSuccess={handleAvatarUploadSuccess}
              onRemoveSuccess={handleAvatarRemoveSuccess}
              disabled={isUploading}
            />
          </div>

          {/* Display Name Section */}
          <div>
            <DisplayNameForm
              initialDisplayName={profile.displayName || ''}
              onSuccess={handleDisplayNameSuccess}
            />
          </div>

          {/* Profile Info */}
          <div className='pt-4 border-t'>
            <h3 className='text-sm font-medium text-gray-900 mb-2'>
              Profile Information
            </h3>
            <div className='space-y-1 text-sm text-gray-600'>
              <p>
                <span className='font-medium'>Email:</span> {profile.email}
              </p>
              <p>
                <span className='font-medium'>Member since:</span>{' '}
                {new Date(profile.createdAt).toLocaleDateString()}
              </p>
              <p>
                <span className='font-medium'>Last updated:</span>{' '}
                {new Date(profile.updatedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
