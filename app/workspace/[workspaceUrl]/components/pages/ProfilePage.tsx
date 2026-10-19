// app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx
'use client'

import { useRef, useState, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { PasswordSettings, useUser } from '@/lib/auth/client'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usersClient } from '@/lib/api-client'

export function ProfilePage() {
  const intl = useIntl()
  const { user, isLoaded } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Initialize name fields once Clerk user data loads
  useEffect(() => {
    if (isLoaded && user) {
      setFirstName(user.firstName ?? '')
      setLastName(user.lastName ?? '')
    }
  }, [isLoaded, user])

  const handleAvatarClick = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so the same file can be re-selected
    e.target.value = ''

    if (file.size > 2 * 1024 * 1024) {
      toast.error(intl.formatMessage({ id: 'profile.fileTooLarge' }))
      return
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error(intl.formatMessage({ id: 'profile.invalidType' }))
      return
    }

    setUploading(true)
    try {
      await usersClient.uploadAvatar(file)
      await user?.reload()
      toast.success(intl.formatMessage({ id: 'profile.avatarUpdated' }))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'profile.uploadFailed' })
      )
    } finally {
      setUploading(false)
    }
  }

  const handleSaveName = async () => {
    setSavingName(true)
    try {
      await usersClient.updateProfile({ firstName, lastName })
      await user?.reload()
      toast.success(intl.formatMessage({ id: 'profile.nameUpdated' }))
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : intl.formatMessage({ id: 'profile.saveFailed' })
      )
    } finally {
      setSavingName(false)
    }
  }

  const initials =
    [user?.firstName?.[0], user?.lastName?.[0]]
      .filter(Boolean)
      .join('')
      .toUpperCase() || '?'

  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-6 py-8'>
        <h1 className='text-xl font-semibold text-foreground mb-1'>
          {intl.formatMessage({ id: 'profile.title' })}
        </h1>
        <p className='text-sm text-muted-foreground mb-8'>
          {intl.formatMessage({ id: 'profile.subtitle' })}
        </p>

        <div className='border border-border rounded-lg overflow-hidden bg-card'>
          {/* Avatar row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
            <div className='flex items-center gap-3'>
              {isLoaded && user?.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={intl.formatMessage({ id: 'profile.avatar' })}
                  className='w-9 h-9 rounded-full object-cover'
                />
              ) : (
                <div className='w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold'>
                  {initials}
                </div>
              )}
              <div>
                <p className='text-sm font-medium text-foreground'>
                  {intl.formatMessage({ id: 'profile.avatar' })}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {intl.formatMessage({ id: 'profile.avatarHint' })}
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/jpeg,image/png,image/webp'
              className='hidden'
              onChange={handleFileChange}
            />
            <Button
              variant='outline'
              size='sm'
              onClick={handleAvatarClick}
              disabled={uploading || !isLoaded}
            >
              {uploading ? (
                <Loader2 size={14} className='animate-spin mr-1.5' />
              ) : (
                <Upload size={14} className='mr-1.5' />
              )}
              {intl.formatMessage({ id: 'profile.upload' })}
            </Button>
          </div>

          {/* Name row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
            <p className='text-sm font-medium text-foreground shrink-0 mr-4'>
              {intl.formatMessage({ id: 'profile.name' })}
            </p>
            <div className='flex items-center gap-2'>
              <Input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder={intl.formatMessage({ id: 'profile.firstName' })}
                className='w-28 h-8 text-sm'
                disabled={savingName || !isLoaded}
              />
              <Input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder={intl.formatMessage({ id: 'profile.lastName' })}
                className='w-28 h-8 text-sm'
                disabled={savingName || !isLoaded}
              />
              <Button
                size='sm'
                onClick={handleSaveName}
                disabled={savingName || !isLoaded}
              >
                {savingName ? (
                  <Loader2 size={14} className='animate-spin' />
                ) : (
                  intl.formatMessage({ id: 'common.save' })
                )}
              </Button>
            </div>
          </div>

          {/* Email row (read-only) */}
          <div className='flex items-center justify-between px-4 py-3'>
            <p className='text-sm font-medium text-foreground'>
              {intl.formatMessage({ id: 'profile.email' })}
            </p>
            <p className='text-sm text-muted-foreground'>
              {isLoaded ? (user?.emailAddresses[0]?.emailAddress ?? '—') : '…'}
            </p>
          </div>
        </div>

        {/* LUM-1070: change password (Better Auth); nothing under Clerk. */}
        <PasswordSettings />
      </div>
    </div>
  )
}
