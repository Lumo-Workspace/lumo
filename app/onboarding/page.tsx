'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import Image from 'next/image'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'

/**
 * Onboarding page — Sprint 1 placeholder.
 * Sprint 2 will replace this with the full "What are you building?" flow.
 */
export default function OnboardingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) return
    setIsSubmitting(true)
    setError('')

    try {
      const slug = generateWorkspaceSlug(name)
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create workspace')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-6">
          <div className="flex justify-center">
            <Image
              src="/logo-dark.svg"
              alt="Lumo Logo"
              width={62}
              height={62}
              className="h-[62px] w-[62px]"
              priority
            />
          </div>
          <CardTitle className="text-sm font-normal text-slate-900">
            Name your workspace
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div className="space-y-4">
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
              disabled={isSubmitting}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />

            {error && <p className="text-xs text-red-600">{error}</p>}

            <Button
              type="button"
              disabled={isSubmitting || !name.trim()}
              onClick={handleSubmit}
              className="w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white"
            >
              {isSubmitting ? 'Creating...' : 'Continue'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
