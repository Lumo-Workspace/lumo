'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Upload, X } from 'lucide-react'
import { PROFILE_CONSTANTS } from '@/types/profile'

interface AvatarUploadProps {
  currentAvatarUrl?: string | null | undefined
  onUploadSuccess?: (avatarUrl: string) => void
  onRemoveSuccess?: () => void
  className?: string | undefined
  disabled?: boolean
}

export function AvatarUpload({
  currentAvatarUrl,
  onUploadSuccess,
  onRemoveSuccess,
  className,
  disabled = false,
}: AvatarUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleFileSelect = async (file: File) => {
    if (disabled || isUploading) return

    // Validate file
    if (file.size > PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE) {
      toast.error('File too large', {
        description: `Please select a file smaller than ${PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE / (1024 * 1024)}MB`,
      })
      return
    }

    if (
      !PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.includes(file.type as any)
    ) {
      toast.error('Unsupported file type', {
        description: `Supported formats: ${PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.join(', ')}`,
      })
      return
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const result = await response.json()
        toast.success('Avatar updated', {
          description: 'Your profile picture has been updated successfully.',
        })
        onUploadSuccess?.(result.avatarUrl)
      } else {
        const errorData = await response.json()
        toast.error('Upload failed', {
          description: errorData.error || 'Failed to upload avatar',
        })
      }
    } catch (error) {
      toast.error('Upload error', {
        description: 'Please check your connection and try again.',
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
    // Reset input
    event.target.value = ''
  }

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    if (!disabled && !isUploading) {
      setDragActive(true)
    }
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)

    if (disabled || isUploading) return

    const file = event.dataTransfer.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleRemove = async () => {
    if (disabled || isRemoving || !currentAvatarUrl) return

    setIsRemoving(true)

    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'DELETE',
      })

      if (response.ok) {
        toast.success('Avatar removed', {
          description: 'Your profile picture has been removed.',
        })
        onRemoveSuccess?.()
      } else {
        const errorData = await response.json()
        toast.error('Remove failed', {
          description: errorData.error || 'Failed to remove avatar',
        })
      }
    } catch (error) {
      toast.error('Network error', {
        description: 'Please check your connection and try again.',
      })
    } finally {
      setIsRemoving(false)
    }
  }

  const handleUploadClick = () => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click()
    }
  }

  return (
    <div className={className}>
      <div className='space-y-4'>
        {/* Upload Area */}
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-6 text-center transition-colors
            ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-gray-400'}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleUploadClick}
        >
          <input
            ref={fileInputRef}
            type='file'
            accept={PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.join(',')}
            onChange={handleFileInputChange}
            className='hidden'
            disabled={disabled || isUploading}
          />

          <div className='space-y-2'>
            <div className='mx-auto w-12 h-12 text-gray-400'>
              {isUploading ? (
                <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500'></div>
              ) : (
                <Upload className='w-12 h-12' />
              )}
            </div>

            <div>
              <p className='text-sm font-medium text-gray-900'>
                {isUploading ? 'Uploading...' : 'Upload avatar'}
              </p>
              <p className='text-sm text-gray-500'>
                Drag and drop or click to select
              </p>
            </div>
          </div>
        </div>

        {/* File Requirements */}
        <div className='text-sm text-gray-500 space-y-1'>
          <p>
            • Supported formats:{' '}
            {PROFILE_CONSTANTS.AVATAR.SUPPORTED_FORMATS.join(', ')}
          </p>
          <p>
            • Maximum size:{' '}
            {PROFILE_CONSTANTS.AVATAR.MAX_FILE_SIZE / (1024 * 1024)}MB
          </p>
          <p>
            • Will be resized to{' '}
            {PROFILE_CONSTANTS.AVATAR.TARGET_DIMENSIONS.width}x
            {PROFILE_CONSTANTS.AVATAR.TARGET_DIMENSIONS.height} pixels
          </p>
        </div>

        {/* Remove Button */}
        {currentAvatarUrl && (
          <Button
            variant='outline'
            onClick={handleRemove}
            disabled={disabled || isRemoving}
            className='w-full'
          >
            {isRemoving ? (
              <>
                <div className='animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500 mr-2'></div>
                Removing...
              </>
            ) : (
              <>
                <X className='w-4 h-4 mr-2' />
                Remove Avatar
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
