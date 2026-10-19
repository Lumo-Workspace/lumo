'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { FormDialog } from '../FormDialog'
import { FormRecoveryBanner } from '../FormRecoveryBanner'
import { isSubmitShortcut, submitModLabel } from '../../utils'
import { useFormRecovery } from '../../hooks/useFormRecovery'
import { CACHE_KEY } from '../../constants'
import { Button } from '@/components/ui/button'

export interface NewProjectFormData {
  name: string
  description: string
}

export interface NewProjectPreFill {
  name: string
  description: string
}

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
  /** Parent handles optimistic create + API call. Throw to show error in modal. */
  onSubmit: (data: NewProjectFormData) => Promise<void>
  preFill?: NewProjectPreFill | undefined
  draftId?: string | undefined
  onSaveDraft?:
    | ((type: 'PROJECT', data: Record<string, unknown>) => Promise<void>)
    | undefined
  onDeleteDraft?: ((id: string) => Promise<void>) | undefined
}

export function NewProjectModal({
  isOpen,
  onClose,
  onSubmit,
  preFill,
  draftId,
  onSaveDraft,
  onDeleteDraft,
}: NewProjectModalProps) {
  const intl = useIntl()
  const [name, setName] = useState(preFill?.name ?? '')
  const [description, setDescription] = useState(preFill?.description ?? '')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const isFromDraft = !!draftId
  const recovery = useFormRecovery<Record<string, unknown>>({
    cacheKey: CACHE_KEY.formRecoveryNewProject,
    disabled: isFromDraft || !!preFill,
    isEmpty: data => {
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
      return !str(data.name) && !str(data.description)
    },
  })

  // Auto-save to localStorage on form changes
  const { save: recoverySave } = recovery
  useEffect(() => {
    if (!isOpen) return
    const formData: Record<string, unknown> = {}
    if (name) formData.name = name
    if (description) formData.description = description
    recoverySave(formData)
  }, [isOpen, name, description, recoverySave])

  const handleRestore = () => {
    const data = recovery.acceptRecovery()
    if (!data) return
    if (data.name && typeof data.name === 'string') setName(data.name)
    if (data.description && typeof data.description === 'string')
      setDescription(data.description)
  }

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
    recovery.clear()
    if (draftId && onDeleteDraft) onDeleteDraft(draftId).catch(() => {})
    reset()
    onClose()
    onSubmit({ name: trimmedName, description }).catch(console.error)
  }

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return
    const formData: Record<string, unknown> = {}
    if (name.trim()) formData.name = name.trim()
    if (description) formData.description = description
    try {
      await onSaveDraft('PROJECT', formData)
      recovery.clear()
      reset()
      onClose()
      toast.success(intl.formatMessage({ id: 'drafts.saved' }))
    } catch {
      toast.error(intl.formatMessage({ id: 'drafts.saveFailed' }))
    }
  }

  return (
    <FormDialog
      isOpen={isOpen}
      onClose={handleClose}
      initialFocusRef={nameInputRef}
      title={intl.formatMessage({ id: 'sidebar.newProject' })}
      footer={
        <div className='flex flex-wrap items-center justify-end gap-3 ml-auto'>
          {onSaveDraft && (
            <Button variant='ghost' onClick={handleSaveDraft}>
              {intl.formatMessage({ id: 'drafts.saveDraft' })}
            </Button>
          )}
          <Button variant='ghost' onClick={handleClose}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>
            Create Project {submitModLabel}↵
          </Button>
        </div>
      }
    >
      {expanded => (
        <div className='space-y-4 h-full flex flex-col'>
          {recovery.recovered && (
            <FormRecoveryBanner
              onRestore={handleRestore}
              onDiscard={recovery.discardRecovery}
            />
          )}
          <input
            ref={nameInputRef}
            className='w-full bg-transparent border-none p-0 text-xl font-medium text-foreground placeholder:text-muted-foreground focus:ring-0 outline-none'
            placeholder={intl.formatMessage({
              id: 'newProject.namePlaceholder',
            })}
            type='text'
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (isSubmitShortcut(e)) handleSubmit()
            }}
          />
          <textarea
            className={`w-full bg-transparent border-none p-0 text-sm text-muted-foreground placeholder:text-muted-foreground focus:ring-0 outline-none resize-none leading-relaxed font-sans ${expanded ? 'flex-1 min-h-0' : 'min-h-[80px]'}`}
            placeholder={intl.formatMessage({
              id: 'newProject.descPlaceholder',
            })}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <div className='flex items-center gap-2 pt-1'>
            <Button
              variant='outline'
              size='sm'
              className='gap-1.5 text-xs font-medium text-muted-foreground'
            >
              <Sparkles size={13} className='text-info-text' />
              {intl.formatMessage({ id: 'newProject.refineWithAI' })}
            </Button>
          </div>
        </div>
      )}
    </FormDialog>
  )
}
