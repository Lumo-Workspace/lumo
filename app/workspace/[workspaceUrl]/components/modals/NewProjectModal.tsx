'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { Modal } from '../Modal'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import { Button } from '@/components/ui/button'

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
  const reset = () => {
    setName('')
    setDescription('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return

    reset()
    onClose()
    onSubmit({ name: trimmedName, description }).catch(console.error)
  }

  return (
    <AnimatePresence>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title='New project'
        footer={
          <div className='flex items-center gap-3 ml-auto'>
            <Button variant='ghost' onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!name.trim()}>
              Create Project {submitModLabel}↵
            </Button>
          </div>
        }
      >
        {expanded => (
          <div className='space-y-4 h-full flex flex-col'>
            <input
              autoFocus
              className='w-full bg-transparent border-none p-0 text-xl font-medium text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:ring-0 outline-none'
              placeholder='Project name'
              type='text'
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (isSubmitShortcut(e)) handleSubmit()
              }}
            />
            <textarea
              className={`w-full bg-transparent border-none p-0 text-sm text-zinc-600 dark:text-zinc-400 placeholder:text-zinc-400 focus:ring-0 outline-none resize-none leading-relaxed font-sans ${expanded ? 'flex-1 min-h-0' : 'min-h-[80px]'}`}
              placeholder='What is this project about?'
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <div className='flex items-center gap-2 pt-1'>
              <Button
                variant='outline'
                size='sm'
                className='gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400'
              >
                <Sparkles size={13} className='text-violet-500' />
                Refine with AI
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AnimatePresence>
  )
}
