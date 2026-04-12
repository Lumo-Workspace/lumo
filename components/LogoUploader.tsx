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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [sizeError, setSizeError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [uploading, setUploading] = useState(false)

  // Initials fallback
  const initials = workspaceName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  // ── File picker handler ────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Guard before reset: if no file (user cancelled picker) or ref gone, bail early
    if (!fileInputRef.current || !file) return
    fileInputRef.current.value = '' // reset so re-selecting same file fires again
    if (file.size > MAX_BYTES) {
      setSizeError('File must be 2 MB or smaller')
      return
    }
    setSizeError(null)
    const objectUrl = URL.createObjectURL(file)
    setSrcUrl(objectUrl)
    setDialogOpen(true)
  }

  // ── Crop image ready ───────────────────────────────────────────────────────
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget
      setCrop(initCrop(naturalWidth, naturalHeight))
    },
    []
  )

  // ── Save (crop → upload) ───────────────────────────────────────────────────
  async function handleSave() {
    const img = imgRef.current
    if (!img || !crop || !srcUrl) return

    // Draw the cropped region onto a canvas.
    // crop is a PercentCrop (0–100), so convert directly via naturalWidth/naturalHeight.
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
          toast.error('Failed to process image')
          return
        }
        if (blob.size > MAX_BYTES) {
          toast.error('Cropped image is too large. Try a smaller crop.')
          return
        }

        setUploading(true)
        try {
          const formData = new FormData()
          formData.append('file', blob, 'logo.jpg')
          const res = await upload(formData)
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Upload failed')
          onUpload(data.logoUrl as string)
          setDialogOpen(false)
          URL.revokeObjectURL(srcUrl)
          setSrcUrl(null)
          toast.success('Logo updated')
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : 'Upload failed, please try again'
          )
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        onChange={handleFileChange}
      />

      {/* Clickable avatar */}
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
            <div className='size-full bg-zinc-800 dark:bg-zinc-700 flex items-center justify-center text-sm font-bold text-white'>
              {initials || '?'}
            </div>
          )}
          {/* Hover overlay */}
          <div className='absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
            <Camera size={16} className='text-white' />
          </div>
        </button>
        {sizeError && <p className='text-xs text-red-500'>{sizeError}</p>}
      </div>

      {/* Crop dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={open => {
          if (!open) handleCancel()
        }}
      >
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>Crop logo</DialogTitle>
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
                  alt='crop preview'
                  onLoad={handleImageLoad}
                  className='max-h-[360px] max-w-full object-contain'
                />
              </ReactCrop>
            </div>
          )}
          <DialogFooter>
            <Button variant='ghost' onClick={handleCancel} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={uploading}>
              {uploading ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
