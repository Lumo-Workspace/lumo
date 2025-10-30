'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import { generateWorkspaceSlug } from '@/utils/team-utils'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'

export default function OnboardingPage() {
  const router = useRouter()
  const [teamName, setTeamName] = useState('')
  const [workspaceUrl, setWorkspaceUrl] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [urlAvailable, setUrlAvailable] = useState(true)
  const [checkingUrl, setCheckingUrl] = useState(false)
  const [urlManuallyEdited, setUrlManuallyEdited] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [teamSize, setTeamSize] = useState<string>('')

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
      } finally {
        setCheckingUrl(false)
      }
    }

    const timeoutId = setTimeout(checkUrl, 500)
    return () => clearTimeout(timeoutId)
  }, [workspaceUrl])

  const createTeam = async (size?: string) => {
    setIsSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/teams/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamName,
          workspaceUrl,
          teamSize: size || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create team')
        return
      }

      router.push('/app')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleContinueFromStep1 = () => {
    // Guard against invalid inputs
    if (!teamName || !workspaceUrl || !urlAvailable || Boolean(error)) return
    setStep(2)
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
              {step === 1
                ? "Enter your team's name."
                : "What's your company size?"}
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent>
          {step === 1 ? (
            <div className='space-y-4'>
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

              {/* Continue Button */}
              <Button
                type='button'
                disabled={
                  isSubmitting ||
                  !teamName ||
                  !urlAvailable ||
                  Boolean(error) ||
                  !workspaceUrl
                }
                onClick={handleContinueFromStep1}
                className='w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white'
              >
                Continue
              </Button>
            </div>
          ) : (
            <div className='space-y-6'>
              {/* Team Size Select */}
              <div className='space-y-2'>
                <Select value={teamSize} onValueChange={setTeamSize}>
                  <SelectTrigger id='teamSize' className='w-full h-10'>
                    <SelectValue placeholder='Select' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='ONE'>1 (Just me)</SelectItem>
                    <SelectItem value='TWO_TO_FIVE'>2 – 5</SelectItem>
                    <SelectItem value='SIX_TO_TWENTY'>6 – 20</SelectItem>
                    <SelectItem value='TWENTY_ONE_TO_FIFTY'>21 – 50</SelectItem>
                    <SelectItem value='FIFTY_ONE_TO_TWO_HUNDRED'>
                      51 – 200
                    </SelectItem>
                    <SelectItem value='TWO_HUNDRED_PLUS'>200+</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='flex flex-col gap-3'>
                <Button
                  type='button'
                  onClick={() => createTeam(teamSize || undefined)}
                  disabled={isSubmitting}
                  className='w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white'
                >
                  Continue
                </Button>
                <Button
                  type='button'
                  onClick={() => createTeam(undefined)}
                  disabled={isSubmitting}
                  className='w-full h-12 text-base font-normal bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
