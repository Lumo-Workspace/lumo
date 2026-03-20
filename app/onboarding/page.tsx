'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import Image from 'next/image'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'

export default function OnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(generateWorkspaceSlug(value))
    }
  }

  const handleSlugChange = (value: string) => {
    const clean = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/^-+/, '')
    setSlug(clean)
    setSlugEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim()) return
    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create workspace')
        return
      }

      router.push(`/workspace/${data.workspace.slug}`)
    } catch {
      setError('Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length >= 2 && slug.length >= 2

  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4'>
      <Card className='w-full max-w-md shadow-xl'>
        <CardHeader className='text-center space-y-6'>
          <div className='flex justify-center'>
            <Image
              src='/logo-dark.svg'
              alt='Lumo Logo'
              width={62}
              height={62}
              className='h-[62px] w-[62px]'
              priority
            />
          </div>
          <CardTitle className='text-sm font-normal text-slate-900'>
            Create your workspace
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className='space-y-4'>
            <div className='space-y-1.5'>
              <Label htmlFor='ws-name' className='text-xs text-slate-500'>
                Workspace name
              </Label>
              <Input
                id='ws-name'
                type='text'
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder='Acme Inc.'
                disabled={isSubmitting}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='ws-url' className='text-xs text-slate-500'>
                Workspace URL
              </Label>
              <div className='flex items-center border border-input rounded-md focus-within:ring-2 focus-within:ring-ring overflow-hidden bg-white'>
                <span className='px-3 text-sm text-slate-400 bg-slate-50 border-r border-input h-9 flex items-center shrink-0 select-none'>
                  lumo.app/
                </span>
                <input
                  id='ws-url'
                  type='text'
                  value={slug}
                  onChange={e => handleSlugChange(e.target.value)}
                  placeholder='acme-inc'
                  disabled={isSubmitting}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  className='flex-1 h-9 px-3 text-sm outline-none bg-transparent'
                />
              </div>
            </div>

            {error && <p className='text-xs text-red-600'>{error}</p>}

            <Button
              type='button'
              disabled={isSubmitting || !isValid}
              onClick={handleSubmit}
              className='w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white'
            >
              {isSubmitting ? 'Creating...' : 'Continue'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
