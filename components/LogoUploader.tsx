'use client'

import { useRef, useState, useCallback } from 'react'
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

interface LogoUploaderProps {
  currentLogoUrl: string | null | undefined
  workspaceName: string
  /** Called with the new public URL after a successful upload. */
  onUpload: (logoUrl: string) => void
  /** Upload function — receives FormData, returns Response. Use workspacesClient.uploadLogo. */
  upload: (formData: FormData) => Promise<Response>
}

function initCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 80 }, 1, width, height),
    width,
    height
  )
}

export function LogoUploader({
  currentLogoUrl,
  workspaceName,
  onUpload,
  upload,
}: LogoUploaderProps) {
  const intl = useIntl()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [sizeError, setSizeError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [uploading, setUploading] = useState(false)

  const initials = workspaceName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current || !file) return
    fileInputRef.current.value = ''
    if (file.size > MAX_BYTES) {
      setSizeError(intl.formatMessage({ id: 'logoUploader.sizeError' }))
      return
    }
    setSizeError(null)
    const objectUrl = URL.createObjectURL(file)
    setSrcUrl(objectUrl)
    setDialogOpen(true)
  }

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget
      setCrop(initCrop(naturalWidth, naturalHeight))
    },
    []
  )

  async function handleSave() {
    const img = imgRef.current
    if (!img || !crop || !srcUrl) return

    const canvas = document.createElement('canvas')
    const pixelCrop = {
      x: (crop.x / 100) * img.naturalWidth,
      y: (crop.y / 100) * img.naturalHeight,
      width: (crop.width / 100) * img.naturalWidth,
      height: (crop.height / 100) * img.naturalHeight,
    }
    const size = Math.min(pixelCrop.width, pixelCrop.height, 512)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(
      img,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      size,
      size
    )

    canvas.toBlob(
      async blob => {
        if (!blob) {
          toast.error(intl.formatMessage({ id: 'logoUploader.processError' }))
          return
        }
        if (blob.size > MAX_BYTES) {
          toast.error(intl.formatMessage({ id: 'logoUploader.cropTooLarge' }))
          return
        }

        setUploading(true)
        try {
          const formData = new FormData()
          formData.append('file', blob, 'logo.jpg')
          const res = await upload(formData)
          // The server's error text is English (or a bare "Internal Server
          // Error") — never shown; the toast is always our localized copy.
          if (!res.ok) {
            toast.error(intl.formatMessage({ id: 'logoUploader.uploadFailed' }))
            return
          }
          const data = (await res.json()) as { logoUrl: string }
          onUpload(data.logoUrl)
          setDialogOpen(false)
          URL.revokeObjectURL(srcUrl)
          setSrcUrl(null)
          toast.success(intl.formatMessage({ id: 'logoUploader.success' }))
        } catch {
          // Network failure or an unreadable response.
          toast.error(intl.formatMessage({ id: 'logoUploader.uploadRetry' }))
        } finally {
          setUploading(false)
        }
      },
      'image/jpeg',
      0.9
    )
  }

  function handleCancel() {
    setDialogOpen(false)
    if (srcUrl) URL.revokeObjectURL(srcUrl)
    setSrcUrl(null)
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        onChange={handleFileChange}
      />

      <div className='flex flex-col items-end gap-1'>
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          className='relative group size-10 rounded-lg overflow-hidden shrink-0'
        >
          {currentLogoUrl ? (
            <img
              src={currentLogoUrl}
              alt={workspaceName}
              className='size-full object-contain'
            />
          ) : (
            <div className='size-full bg-muted-foreground flex items-center justify-center text-sm font-bold text-white'>
              {initials || '?'}
            </div>
          )}
          <div className='absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
            <Camera size={16} className='text-white' />
          </div>
        </button>
        {sizeError && <p className='text-xs text-red-500'>{sizeError}</p>}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={open => {
          if (!open) handleCancel()
        }}
      >
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'logoUploader.dialogTitle' })}
            </DialogTitle>
          </DialogHeader>
          {srcUrl && (
            <div className='flex justify-center'>
              <ReactCrop
                {...(crop !== undefined ? { crop } : {})}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                aspect={1}
                circularCrop={false}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={srcUrl}
                  alt=''
                  onLoad={handleImageLoad}
                  className='max-h-[360px] max-w-full object-contain'
                />
              </ReactCrop>
            </div>
          )}
          <DialogFooter>
            <Button variant='ghost' onClick={handleCancel} disabled={uploading}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button onClick={handleSave} disabled={uploading}>
              {uploading
                ? intl.formatMessage({ id: 'common.saving' })
                : intl.formatMessage({ id: 'common.save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
