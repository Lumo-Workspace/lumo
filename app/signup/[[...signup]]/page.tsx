'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { waitlistClient, ApiClientError } from '@/lib/api-client'

export default function WaitlistPage() {
  const intl = useIntl()
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
      if (err instanceof ApiClientError && err.status === 429) {
        setMessage(intl.formatMessage({ id: 'waitlist.error.rateLimited' }))
      } else {
        setMessage(
          err instanceof ApiClientError
            ? err.message
            : intl.formatMessage({ id: 'waitlist.error.network' })
        )
      }
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-[#0a0a0b] px-4'>
      <div className='w-full max-w-md'>
        <div className='mb-8 flex items-center justify-center gap-3'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src='/logo-dark.svg' alt='Lumo' className='h-10 w-auto' />
          <span className='text-3xl font-bold text-white'>Lumo</span>
        </div>

        {status === 'success' ? (
          <div className='rounded-2xl border border-white/10 bg-white/5 p-8 text-center'>
            <div className='mb-4 text-4xl'>🎉</div>
            <h2 className='mb-2 text-xl font-semibold text-white'>
              {intl.formatMessage({ id: 'waitlist.success.title' })}
            </h2>
            <p className='text-sm text-zinc-400'>
              {intl.formatMessage({ id: 'waitlist.success.body' })}
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className='flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/5 p-8'
          >
            <div className='text-center'>
              <h1 className='text-xl font-semibold text-white'>
                {intl.formatMessage({ id: 'waitlist.heading' })}
              </h1>
              <p className='mt-1 text-sm text-zinc-400'>
                {intl.formatMessage({ id: 'waitlist.subheading' })}
              </p>
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='email'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.email' })}{' '}
                <span className='text-red-400'>*</span>
              </label>
              <input
                id='email'
                type='email'
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'waitlist.placeholder.email',
                })}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='name'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.name' })}
              </label>
              <input
                id='name'
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'waitlist.placeholder.name',
                })}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='company'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.company' })}
              </label>
              <input
                id='company'
                type='text'
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'waitlist.placeholder.company',
                })}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='teamSize'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.teamSize' })}
              </label>
              <select
                id='teamSize'
                value={teamSize}
                onChange={e => setTeamSize(e.target.value)}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              >
                <option value='' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.select' })}
                </option>
                <option value='1' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.justMe' })}
                </option>
                <option value='2-5' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.2to5' })}
                </option>
                <option value='6-15' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.6to15' })}
                </option>
                <option value='16-50' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.16to50' })}
                </option>
                <option value='50+' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.50plus' })}
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
              {status === 'loading'
                ? intl.formatMessage({ id: 'waitlist.button.submitting' })
                : intl.formatMessage({ id: 'waitlist.button.submit' })}
            </button>
          </form>
        )}

        <p className='mt-6 text-center text-xs text-zinc-500'>
          {intl.formatMessage({ id: 'waitlist.footer' })}
        </p>
      </div>
    </div>
  )
}
