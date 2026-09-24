'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import Image from 'next/image'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'
import { Plus, X } from 'lucide-react'

function WorkspaceStep({
  onCreated,
}: {
  onCreated: (workspaceId: string, slug: string) => void
}) {
  const intl = useIntl()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) setSlug(generateWorkspaceSlug(value))
  }

  const handleSlugChange = (value: string) => {
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+/, '')
    )
    setSlugEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim()) return
    setIsSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          data.error ||
            intl.formatMessage({ id: 'onboarding.workspace.error.create' })
        )
        return
      }
      onCreated(data.workspace.id, data.workspace.slug)
    } catch {
      setError(intl.formatMessage({ id: 'onboarding.error.generic' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length >= 2 && slug.length >= 2

  return (
    <Card className='w-full max-w-md shadow-elevation-3'>
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
        <CardTitle className='text-sm font-normal text-foreground'>
          {intl.formatMessage({ id: 'onboarding.workspace.title' })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='ws-name' className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'onboarding.workspace.nameLabel' })}
            </Label>
            <Input
              id='ws-name'
              type='text'
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'onboarding.workspace.namePlaceholder',
              })}
              disabled={isSubmitting}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='ws-url' className='text-xs text-muted-foreground'>
              {intl.formatMessage({ id: 'onboarding.workspace.urlLabel' })}
            </Label>
            <div className='flex items-center border border-input rounded-md focus-within:ring-2 focus-within:ring-ring overflow-hidden bg-white'>
              <span className='px-3 text-sm text-muted-foreground bg-muted border-r border-input h-9 flex items-center shrink-0 select-none'>
                lumo.app/
              </span>
              <input
                id='ws-url'
                type='text'
                value={slug}
                onChange={e => handleSlugChange(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'onboarding.workspace.urlPlaceholder',
                })}
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
            className='w-full h-12 text-base font-normal'
          >
            {isSubmitting
              ? intl.formatMessage({ id: 'common.creating' })
              : intl.formatMessage({ id: 'onboarding.workspace.continue' })}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function InviteStep({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const intl = useIntl()
  const router = useRouter()
  const [emails, setEmails] = useState<string[]>([''])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  const updateEmail = (index: number, value: string) => {
    setEmails(prev => prev.map((e, i) => (i === index ? value : e)))
  }

  const addEmail = () => setEmails(prev => [...prev, ''])

  const removeEmail = (index: number) =>
    setEmails(prev => prev.filter((_, i) => i !== index))

  const validEmails = emails.map(e => e.trim()).filter(e => e.length > 0)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const allValid =
    validEmails.length > 0 && validEmails.every(e => emailRegex.test(e))

  const handleSend = async () => {
    if (!allValid) return
    setIsSending(true)
    setError('')
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: validEmails, workspaceId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          data.error ||
            intl.formatMessage({ id: 'onboarding.invite.error.send' })
        )
        setIsSending(false)
        return
      }
      router.push(`/workspace/${workspaceSlug}`)
    } catch {
      setError(intl.formatMessage({ id: 'onboarding.error.generic' }))
      setIsSending(false)
    }
  }

  const handleSkip = () => router.push(`/workspace/${workspaceSlug}`)

  return (
    <Card className='w-full max-w-md shadow-elevation-3'>
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
        <div>
          <CardTitle className='text-sm font-normal text-foreground'>
            {intl.formatMessage({ id: 'onboarding.invite.title' })}
          </CardTitle>
          <p className='text-xs text-muted-foreground mt-1'>
            {intl.formatMessage({ id: 'onboarding.invite.subtitle' })}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className='space-y-4'>
          <div className='space-y-2'>
            {emails.map((email, i) => (
              <div key={i} className='flex items-center gap-2'>
                <Input
                  type='email'
                  value={email}
                  onChange={e => updateEmail(i, e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'onboarding.invite.emailPlaceholder',
                  })}
                  disabled={isSending}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (i === emails.length - 1) addEmail()
                    }
                  }}
                />
                {emails.length > 1 && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-9 w-9 shrink-0 text-muted-foreground'
                    onClick={() => removeEmail(i)}
                    disabled={isSending}
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {emails.length < 5 && (
            <button
              onClick={addEmail}
              disabled={isSending}
              className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors'
            >
              <Plus size={12} />
              {intl.formatMessage({ id: 'onboarding.invite.addAnother' })}
            </button>
          )}

          {error && <p className='text-xs text-red-600'>{error}</p>}

          <Button
            disabled={isSending || !allValid}
            onClick={handleSend}
            className='w-full h-12 text-base font-normal'
          >
            {isSending
              ? intl.formatMessage({ id: 'common.sending' })
              : intl.formatMessage({ id: 'onboarding.invite.send' })}
          </Button>

          <button
            onClick={handleSkip}
            disabled={isSending}
            className='w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1'
          >
            {intl.formatMessage({ id: 'onboarding.invite.skip' })}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

export function OnboardingClient() {
  const [step, setStep] = useState<'workspace' | 'invite'>('workspace')
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')

  const handleWorkspaceCreated = (id: string, slug: string) => {
    setWorkspaceId(id)
    setWorkspaceSlug(slug)
    setStep('invite')
  }

  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted py-12 px-4'>
      {step === 'workspace' ? (
        <WorkspaceStep onCreated={handleWorkspaceCreated} />
      ) : (
        <InviteStep workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      )}
    </div>
  )
}
