'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { Modal } from '../Modal'

export interface NewProjectFormData {
  name: string
  description: string
}

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
  /** Parent handles optimistic create + API call. Throw to show error in modal. */
  onSubmit: (data: NewProjectFormData) => Promise<void>
}

export function NewProjectModal({
  isOpen,
  onClose,
  onSubmit,
}: NewProjectModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setDescription('')
    setError(null)
    setLoading(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) return

    setLoading(true)
    setError(null)
    try {
      await onSubmit({ name: trimmedName, description })
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title='New project'
        footer={
          <div className='flex items-center gap-3 ml-auto'>
            {error && <p className='text-xs text-red-500 mr-auto'>{error}</p>}
            <button
              onClick={handleClose}
              disabled={loading}
              className='px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50'
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !name.trim()}
              className='px-4 py-2 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed'
            >
              {loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        }
      >
        <div className='space-y-4'>
          <input
            autoFocus
            className='w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
            placeholder='Project name'
            type='text'
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) handleSubmit()
            }}
          />
          <textarea
            className='w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 focus:ring-0 outline-none resize-none leading-relaxed min-h-[80px] font-sans'
            placeholder='What is this project about?'
            rows={4}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <div className='flex items-center gap-2 pt-1'>
            <button className='flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors'>
              <Sparkles size={13} className='text-violet-500' />
              Refine with AI
            </button>
          </div>
        </div>
      </Modal>
    </AnimatePresence>
  )
}
