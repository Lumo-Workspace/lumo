'use client'

import { useState } from 'react'
import { waitlistClient, ApiClientError } from '@/lib/api-client'

export default function WaitlistPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error' | 'duplicate'
  >('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')

    try {
      const { result, message: msg } = await waitlistClient.join({
        email,
        name,
        company,
        teamSize,
      })
      setStatus(result === 'created' ? 'success' : 'duplicate')
      setMessage(msg)
    } catch (err) {
      setStatus('error')
      setMessage(
        err instanceof ApiClientError
          ? err.message
          : 'Network error. Please try again.'
      )
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-[#0a0a0b] px-4'>
      <div className='w-full max-w-md'>
        {/* Logo */}
        <div className='mb-8 flex items-center justify-center gap-3'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src='/logo-dark.svg' alt='Lumo' className='h-10 w-auto' />
          <span className='text-3xl font-bold text-white'>Lumo</span>
        </div>

        {status === 'success' ? (
          <div className='rounded-2xl border border-white/10 bg-white/5 p-8 text-center'>
            <div className='mb-4 text-4xl'>🎉</div>
            <h2 className='mb-2 text-xl font-semibold text-white'>
              You&apos;re on the list!
            </h2>
            <p className='text-sm text-zinc-400'>
              We&apos;ll reach out when your spot is ready.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className='flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/5 p-8'
          >
            <div className='text-center'>
              <h1 className='text-xl font-semibold text-white'>
                Join the Waitlist
              </h1>
              <p className='mt-1 text-sm text-zinc-400'>
                Get early access to Lumo.
              </p>
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='email'
                className='text-sm font-medium text-zinc-300'
              >
                Work email <span className='text-red-400'>*</span>
              </label>
              <input
                id='email'
                type='email'
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder='you@company.com'
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='name'
                className='text-sm font-medium text-zinc-300'
              >
                Name
              </label>
              <input
                id='name'
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='Jane Smith'
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='company'
                className='text-sm font-medium text-zinc-300'
              >
                Company
              </label>
              <input
                id='company'
                type='text'
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder='Acme Inc.'
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='teamSize'
                className='text-sm font-medium text-zinc-300'
              >
                Team size
              </label>
              <select
                id='teamSize'
                value={teamSize}
                onChange={e => setTeamSize(e.target.value)}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              >
                <option value='' className='bg-zinc-900'>
                  Select...
                </option>
                <option value='1' className='bg-zinc-900'>
                  Just me
                </option>
                <option value='2-5' className='bg-zinc-900'>
                  2–5
                </option>
                <option value='6-15' className='bg-zinc-900'>
                  6–15
                </option>
                <option value='16-50' className='bg-zinc-900'>
                  16–50
                </option>
                <option value='50+' className='bg-zinc-900'>
                  50+
                </option>
              </select>
            </div>

            {(status === 'error' || status === 'duplicate') && (
              <p
                className={`text-sm ${status === 'error' ? 'text-red-400' : 'text-amber-400'}`}
              >
                {message}
              </p>
            )}

            <button
              type='submit'
              disabled={status === 'loading'}
              className='rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50'
            >
              {status === 'loading' ? 'Submitting...' : 'Join Waitlist'}
            </button>
          </form>
        )}

        <p className='mt-6 text-center text-xs text-zinc-500'>
          We&apos;ll never share your email. Unsubscribe anytime.
        </p>
      </div>
    </div>
  )
}
