'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import { ApiClientError } from '@/lib/api-client/base'
import type { MaterializePlanInput } from '@/lib/validation/plan-run'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Gate C (闸门C · 物化, LUM-671) — the materialisation gate. Renders the
 * human-readable prose (editable), each Stage-3 draft's tasks with keep/strike
 * toggles, and a project picker defaulting to the workspace's sole project.
 * Accepting posts the confirmed plan to the materialisation endpoint.
 *
 * Data-fetching + UI state live here; all business logic (validation, the
 * transaction) is server-side behind `planRunsClient` (Component → API Client →
 * API Route → Service → Repository).
 */
export function GateCView({
  runId,
  workspaceUrl,
}: {
  runId: string
  workspaceUrl: string
}) {
  const intl = useIntl()
  const router = useRouter()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.planRuns.materializeGate(runId),
    queryFn: () => planRunsClient.getGateC(runId),
  })

  // Editable state, seeded from the fetched gate data.
  const [prose, setProse] = useState('')
  const [projectId, setProjectId] = useState('')
  // Keep/strike per task, keyed `${draftIndex}:${taskIndex}` (default kept).
  const [struck, setStruck] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!data) return
    setProse(data.prose)
    setProjectId(data.defaultProjectId ?? '')
  }, [data])

  const materialize = useMutation({
    mutationFn: (input: MaterializePlanInput) =>
      planRunsClient.materialize(runId, input),
  })

  const keptCount = useMemo(() => {
    if (!data) return 0
    let n = 0
    data.drafts.forEach((d, di) =>
      d.tasks.forEach((_, ti) => {
        if (!struck[`${di}:${ti}`]) n++
      })
    )
    return n
  }, [data, struck])

  function toggle(di: number, ti: number) {
    const key = `${di}:${ti}`
    setStruck(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function accept() {
    if (!data) return
    const input: MaterializePlanInput = {
      projectId,
      proseDocument: prose,
      drafts: data.drafts.map((d, di) => ({
        clusterId: d.clusterId,
        goalStatement: d.goalStatement,
        assumptionNote: d.assumptionNote,
        ideaIds: d.ideaIds,
        tasks: d.tasks.map((t, ti) => ({
          title: t.title,
          why: t.why,
          size: t.size,
          keep: !struck[`${di}:${ti}`],
        })),
      })),
    }
    materialize.mutate(input)
  }

  if (isLoading) {
    return (
      <div className='mx-auto flex max-w-3xl items-center gap-2 p-8 text-muted-foreground'>
        <Spinner /> {intl.formatMessage({ id: 'plan.gateC.loading' })}
      </div>
    )
  }

  if (isError || !data) {
    const msg =
      error instanceof ApiClientError
        ? error.message
        : intl.formatMessage({ id: 'plan.gateC.loadError' })
    return (
      <div className='mx-auto max-w-3xl p-8'>
        <p className='text-danger-text'>{msg}</p>
      </div>
    )
  }

  if (materialize.isSuccess) {
    const done = materialize.data
    return (
      <div className='mx-auto max-w-3xl p-8'>
        <h1 className='text-xl font-semibold'>
          {intl.formatMessage({ id: 'plan.gateC.doneTitle' })}
        </h1>
        <p className='mt-2 text-muted-foreground'>
          {intl.formatMessage(
            { id: 'plan.gateC.doneSummary' },
            { initiatives: done.initiatives.length, tasks: done.taskCount }
          )}
        </p>
        <Button
          className='mt-6'
          onClick={() => router.push(`/workspace/${workspaceUrl}`)}
        >
          {intl.formatMessage({ id: 'plan.gateC.backToWorkspace' })}
        </Button>
      </div>
    )
  }

  const noProject = data.projects.length === 0
  const submitError =
    materialize.error instanceof ApiClientError
      ? materialize.error.message
      : materialize.isError
        ? intl.formatMessage({ id: 'plan.gateC.materializeError' })
        : null

  return (
    <div className='mx-auto max-w-3xl space-y-8 p-8'>
      <header>
        <h1 className='text-xl font-semibold'>
          {intl.formatMessage({ id: 'plan.gateC.title' })}
        </h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          {intl.formatMessage({ id: 'plan.gateC.subtitle' })}
        </p>
      </header>

      {/* Editable prose document */}
      <section className='space-y-2'>
        <Label htmlFor='gatec-prose'>
          {intl.formatMessage({ id: 'plan.gateC.proseLabel' })}
        </Label>
        <Textarea
          id='gatec-prose'
          value={prose}
          onChange={e => setProse(e.target.value)}
          rows={10}
          className='font-mono text-sm'
        />
      </section>

      {/* Project picker (defaults to the sole project — D4) */}
      <section className='space-y-2'>
        <Label htmlFor='gatec-project'>
          {intl.formatMessage({ id: 'plan.gateC.projectLabel' })}
        </Label>
        {noProject ? (
          <p className='text-sm text-danger-text'>
            {intl.formatMessage({ id: 'plan.gateC.noProject' })}
          </p>
        ) : (
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger id='gatec-project' className='w-full'>
              <SelectValue
                placeholder={intl.formatMessage({
                  id: 'plan.gateC.projectPlaceholder',
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {data.projects.map(p => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </section>

      {/* Draft task lists with keep/strike toggles */}
      {data.drafts.map((draft, di) => (
        <section key={draft.clusterId} className='space-y-3'>
          <div>
            <h2 className='font-medium'>{draft.goalStatement}</h2>
            {draft.assumptionNote ? (
              <p className='mt-1 text-xs text-muted-foreground'>
                {intl.formatMessage({ id: 'plan.gateC.assumption' })}:{' '}
                {draft.assumptionNote}
              </p>
            ) : null}
          </div>
          <ul className='space-y-2'>
            {draft.tasks.map((task, ti) => {
              const key = `${di}:${ti}`
              const isStruck = !!struck[key]
              return (
                <li key={key} className='flex items-start gap-3'>
                  <Checkbox
                    id={`task-${key}`}
                    checked={!isStruck}
                    onCheckedChange={() => toggle(di, ti)}
                    className='mt-1'
                  />
                  <Label
                    htmlFor={`task-${key}`}
                    className={`flex-1 cursor-pointer font-normal ${
                      isStruck ? 'text-muted-foreground line-through' : ''
                    }`}
                  >
                    <span className='font-medium'>{task.title}</span>
                    <span className='ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-xs'>
                      {task.size}
                    </span>
                    <span className='mt-0.5 block text-xs text-muted-foreground'>
                      {task.why}
                    </span>
                  </Label>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {submitError ? (
        <p className='text-sm text-danger-text'>{submitError}</p>
      ) : null}

      <div className='flex items-center gap-4 border-t pt-6'>
        <Button
          onClick={accept}
          disabled={materialize.isPending || keptCount === 0 || !projectId}
        >
          {materialize.isPending
            ? intl.formatMessage({ id: 'plan.gateC.materializing' })
            : intl.formatMessage({ id: 'plan.gateC.accept' })}
        </Button>
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage(
            { id: 'plan.gateC.keptCount' },
            { count: keptCount }
          )}
        </span>
      </div>
    </div>
  )
}
