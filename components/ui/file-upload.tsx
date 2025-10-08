'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Upload, X, FileText, Image } from 'lucide-react'

interface FileUploadProps {
  onUpload: (
    file: File
  ) => Promise<{ success: boolean; url?: string; error?: string }>
  accept?: string
  maxSize?: number
  className?: string
  type?: 'avatar' | 'document'
}

export function FileUpload({
  onUpload,
  accept,
  maxSize = 5 * 1024 * 1024, // 5MB default
  className,
  type = 'document',
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file size
    if (file.size > maxSize) {
      setError(
        `File size must be less than ${Math.round(maxSize / 1024 / 1024)}MB`
      )
      return
    }

    setUploadedFile(file)
    setError(null)
  }

  const handleUpload = async () => {
    if (!uploadedFile) return

    setIsUploading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await onUpload(uploadedFile)

      if (result.success) {
        setSuccess('File uploaded successfully!')
        setUploadedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      } else {
        setError(result.error || 'Upload failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveFile = () => {
    setUploadedFile(null)
    setError(null)
    setSuccess(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <Image className='h-8 w-8 text-blue-500' />
    }
    return <FileText className='h-8 w-8 text-gray-500' />
  }

  return (
    <div className={className}>
      <Card>
        <CardContent className='p-6'>
          <div className='space-y-4'>
            {/* File Input */}
            <div className='border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors'>
              <input
                ref={fileInputRef}
                type='file'
                accept={accept}
                onChange={handleFileSelect}
                className='hidden'
                id='file-upload'
              />
              <label
                htmlFor='file-upload'
                className='cursor-pointer flex flex-col items-center space-y-2'
              >
                <Upload className='h-8 w-8 text-gray-400' />
                <div className='text-sm text-gray-600'>
                  <span className='font-medium text-blue-600 hover:text-blue-500'>
                    Click to upload
                  </span>{' '}
                  or drag and drop
                </div>
                <div className='text-xs text-gray-500'>
                  Max size: {Math.round(maxSize / 1024 / 1024)}MB
                </div>
              </label>
            </div>

            {/* Selected File */}
            {uploadedFile && (
              <div className='flex items-center space-x-3 p-3 bg-gray-50 rounded-lg'>
                {getFileIcon(uploadedFile)}
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium text-gray-900 truncate'>
                    {uploadedFile.name}
                  </p>
                  <p className='text-xs text-gray-500'>
                    {formatFileSize(uploadedFile.size)}
                  </p>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={handleRemoveFile}
                  className='text-gray-400 hover:text-gray-600'
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className='p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md'>
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className='p-3 text-sm text-green-600 bg-green-50 border border-green-200 rounded-md'>
                {success}
              </div>
            )}

            {/* Upload Button */}
            {uploadedFile && (
              <Button
                onClick={handleUpload}
                disabled={isUploading}
                className='w-full'
              >
                {isUploading ? (
                  <>
                    <Upload className='h-4 w-4 mr-2 animate-spin' />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className='h-4 w-4 mr-2' />
                    Upload {type === 'avatar' ? 'Avatar' : 'Document'}
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
