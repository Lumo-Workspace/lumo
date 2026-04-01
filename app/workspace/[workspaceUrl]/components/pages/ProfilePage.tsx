// app/workspace/[workspaceUrl]/components/pages/ProfilePage.tsx
'use client'

import { useRef, useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '../../utils'

export function ProfilePage() {
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
      toast.error('File must be 2 MB or smaller')
      return
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Only JPG, PNG, and WebP are allowed')
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      // Use raw fetch — apiFetch forces Content-Type: application/json which breaks FormData
      const res = await fetch('/api/users/profile/avatar', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error ?? 'Upload failed')
      }
      await user?.reload()
      toast.success('Avatar updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleSaveName = async () => {
    setSavingName(true)
    try {
      const res = await apiFetch('/api/users/profile', {
        method: 'PATCH',
        body: { firstName, lastName },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error((data as { error?: string }).error ?? 'Save failed')
      }
      await user?.reload()
      toast.success('Name updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
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
        <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-1'>
          Profile
        </h1>
        <p className='text-sm text-zinc-500 dark:text-zinc-400 mb-8'>
          Manage your personal information.
        </p>

        <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900'>
          {/* Avatar row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <div className='flex items-center gap-3'>
              {isLoaded && user?.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt='Avatar'
                  className='w-9 h-9 rounded-full object-cover'
                />
              ) : (
                <div className='w-9 h-9 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-semibold'>
                  {initials}
                </div>
              )}
              <div>
                <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
                  Avatar
                </p>
                <p className='text-xs text-zinc-400'>
                  JPG, PNG or WebP. Max 2 MB
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
              Upload
            </Button>
          </div>

          {/* Name row */}
          <div className='flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
            <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100 shrink-0 mr-4'>
              Name
            </p>
            <div className='flex items-center gap-2'>
              <Input
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder='First name'
                className='w-28 h-8 text-sm'
                disabled={savingName || !isLoaded}
              />
              <Input
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder='Last name'
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
                  'Save'
                )}
              </Button>
            </div>
          </div>

          {/* Email row (read-only) */}
          <div className='flex items-center justify-between px-4 py-3'>
            <p className='text-sm font-medium text-zinc-900 dark:text-zinc-100'>
              Email
            </p>
            <p className='text-sm text-zinc-400'>
              {isLoaded ? (user?.emailAddresses[0]?.emailAddress ?? '—') : '…'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
