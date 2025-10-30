'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import { generateWorkspaceSlug } from '@/utils/team-utils'

export default function OnboardingPage() {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [workspaceUrl, setWorkspaceUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [urlAvailable, setUrlAvailable] = useState(true)
  const [checkingUrl, setCheckingUrl] = useState(false)
  const [urlManuallyEdited, setUrlManuallyEdited] = useState(false)

  // Auto-generate URL from team name until user edits the URL manually
  useEffect(() => {
    if (!urlManuallyEdited) {
      const generated = generateWorkspaceSlug(teamName)
      setWorkspaceUrl(generated)
    }
  }, [teamName, urlManuallyEdited])

  // Check URL availability in real-time (debounced)
  useEffect(() => {
    if (!workspaceUrl) return

    const checkUrl = async () => {
      setCheckingUrl(true)
      try {
        const response = await fetch(
          `/api/teams/check-url?url=${encodeURIComponent(workspaceUrl)}`
        )
        const data = await response.json()
        setUrlAvailable(Boolean(data.available))
        if (!data.valid) {
          setError(data.error)
        } else {
          setError('')
        }
      } catch (err) {
        console.error('URL check failed:', err)
      } finally {
        setCheckingUrl(false)
      }
    }

    const timeoutId = setTimeout(checkUrl, 500)
    return () => clearTimeout(timeoutId)
  }, [workspaceUrl])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName,
          workspaceUrl,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create team')
        return
      }

      // Redirect to app
      router.push('/app')
    } catch (err) {
      console.error('Team creation failed:', err)
      setError('Failed to create team. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4'>
      <Card className='w-full max-w-md shadow-xl'>
        <CardHeader className='text-center space-y-6'>
          {/* Logo */}
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

          {/* Title */}
          <div className='space-y-2'>
            <CardTitle className='text-sm font-normal text-slate-900'>
              Enter your team's name.
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className='space-y-4'>
            {/* Team Name Input */}
            <div className='space-y-2'>
              <label
                htmlFor='teamName'
                className='text-sm font-medium text-slate-700'
              >
                Team's Name
              </label>
              <Input
                id='teamName'
                type='text'
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                placeholder='Acme Corporation'
                disabled={isSubmitting}
                required
                minLength={2}
                maxLength={100}
                className='w-full'
              />
            </div>

            {/* Workspace URL Input (always visible, auto-generated, overridable) */}
            <div className='space-y-2'>
              <label
                htmlFor='workspaceUrl'
                className='text-sm font-medium text-slate-700'
              >
                Workspace URL
              </label>
              <div className='relative'>
                <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500'>
                  uselumo.ai/
                </span>
                <Input
                  id='workspaceUrl'
                  type='text'
                  value={workspaceUrl}
                  onChange={e => {
                    const value = e.target.value
                    setWorkspaceUrl(value)
                    // Mark as manually edited once user types something not equal to generated slug
                    const generated = generateWorkspaceSlug(teamName)
                    if (value !== generated) setUrlManuallyEdited(true)
                    if (value === '') setUrlManuallyEdited(false)
                  }}
                  placeholder='acme-corp'
                  disabled={isSubmitting || checkingUrl}
                  required
                  className='w-full pl-[5.5rem]'
                />
              </div>
              {checkingUrl && (
                <p className='text-xs text-slate-500'>
                  Checking availability...
                </p>
              )}
              {!checkingUrl && workspaceUrl && !urlAvailable && (
                <p className='text-xs text-red-600'>
                  This URL is already taken
                </p>
              )}
              {!checkingUrl && workspaceUrl && urlAvailable && !error && (
                <p className='text-xs text-green-600'>✓ Available</p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className='rounded-lg bg-red-50 p-3 text-sm text-red-600'>
                {error}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type='submit'
              disabled={
                isSubmitting ||
                !teamName ||
                !urlAvailable ||
                Boolean(error) ||
                !workspaceUrl
              }
              className='w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white'
            >
              {isSubmitting ? 'Creating...' : 'Create Team'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
