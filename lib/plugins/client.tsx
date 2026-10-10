'use client'

/**
 * LUM-1062 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §3.2, §3.4
 * UI 插槽) — the client side of the plugin contract.
 *
 * Kept apart from the server registry (`lib/plugins/types.ts`,
 * `registry.ts`) so no server code reaches the browser bundle. The core
 * places a slot; each installed client plugin may fill it with a 'use client'
 * component. With no plugin a slot renders nothing.
 *
 * Plugins come from the static list in `installed.client.ts` (the OSS
 * snapshot overlays it with an empty list, RFC §3.3). The components are
 * imported statically, not through `next/dynamic`: a lazily loaded slot
 * would paint a beat after the core around it (a PR badge, the Done gate),
 * and a plugin that is not installed is not in the bundle anyway.
 */
import { Fragment, type ComponentType, type ReactNode } from 'react'
import { INSTALLED_CLIENT_PLUGINS } from './installed.client'

/** A workspace settings row as GET /api/workspaces/me serves it. */
export type WorkspaceSettingsView = Readonly<Record<string, unknown>>

/** One plugin's share of the task dossier (the Record tab). */
export interface TaskDossierContribution {
  /** Open items of this plugin that hard-block DONE (Done gate + Needs action). */
  blocking: number
  /** The plugin has a result for this task (the gate row reads "clear", not "not checked"). */
  checked: boolean
  /** Shown in Needs action while the summed `blocking` is above 0. */
  needsAction: ReactNode
  /** A Records row, or null. */
  record: ReactNode
}

/** The props each slot hands its components. */
export interface ClientSlotProps {
  /**
   * The task dossier. A render prop: the component reads its data and calls
   * `children` with its contribution, so the core's Done gate and Records
   * render in the same pass (no effect round-trip, no flash).
   */
  'task.dossier': {
    taskId: string
    expanded: boolean
    onToggle: () => void
    children: (contribution: TaskDossierContribution) => ReactNode
  }
  /** Next to a linked PR's state badge (task sidebar). */
  'task.pullRequest.badge': { taskId: string; pullRequestId: string }
  /** Under a boundary crossing's detail (the crossings panel). */
  'task.crossing.annotation': {
    crossingId: string
    triageProbability: number | null
    disposition: string | null
  }
  /** A card on Settings → General (OWNER only, once the row is loaded). */
  'settings.workspace.section': {
    workspace: WorkspaceSettingsView
    /** The whole GET /api/workspaces/me response (plugin top-level fields). */
    me: Readonly<Record<string, unknown>>
  }
  /** A row in Settings → Data retention. */
  'settings.retention.row': { workspace: WorkspaceSettingsView }
}

export type ClientSlotName = keyof ClientSlotProps

export interface LumoClientPlugin {
  /** Stable id, e.g. `'security'`; also keys the plugin's dossier row state. */
  id: string
  slots: { [K in ClientSlotName]?: ComponentType<ClientSlotProps[K]> }
}

type SimpleSlotName = Exclude<ClientSlotName, 'task.dossier'>

/** Every installed component for `name`, in installed order. */
function slotComponents<K extends ClientSlotName>(
  plugins: readonly LumoClientPlugin[],
  name: K
): { id: string; Component: ComponentType<ClientSlotProps[K]> }[] {
  return plugins.flatMap(p => {
    const Component = p.slots[name] as
      | ComponentType<ClientSlotProps[K]>
      | undefined
    return Component ? [{ id: p.id, Component }] : []
  })
}

/** Renders every installed plugin's component for the slot; nothing without one. */
export function PluginSlot<K extends SimpleSlotName>({
  name,
  props,
  plugins = INSTALLED_CLIENT_PLUGINS,
}: {
  name: K
  props: ClientSlotProps[K]
  /** Tests only; defaults to the installed list. */
  plugins?: readonly LumoClientPlugin[]
}) {
  return (
    <>
      {slotComponents(plugins, name).map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </>
  )
}

/** The plugin contributions to one task dossier, merged. */
export interface MergedDossierContribution {
  /** At least one plugin contributes (the Done gate shows its row). */
  present: boolean
  blocking: number
  checked: boolean
  needsAction: ReactNode
  records: ReactNode
}

export function mergeDossierContributions(
  parts: readonly { id: string; contribution: TaskDossierContribution }[]
): MergedDossierContribution {
  return {
    present: parts.length > 0,
    blocking: parts.reduce((n, p) => n + p.contribution.blocking, 0),
    checked: parts.some(p => p.contribution.checked),
    needsAction:
      parts.length > 0 ? (
        <>
          {parts.map(p => (
            <Fragment key={p.id}>{p.contribution.needsAction}</Fragment>
          ))}
        </>
      ) : null,
    records:
      parts.length > 0 ? (
        <>
          {parts.map(p => (
            <Fragment key={p.id}>{p.contribution.record}</Fragment>
          ))}
        </>
      ) : null,
  }
}

type DossierSlot = {
  id: string
  Component: ComponentType<ClientSlotProps['task.dossier']>
}

/** Nests each plugin's render prop, then renders `render` with the merge. */
function DossierChain({
  slots,
  index,
  parts,
  taskId,
  isExpanded,
  onToggle,
  render,
}: {
  slots: readonly DossierSlot[]
  index: number
  parts: readonly { id: string; contribution: TaskDossierContribution }[]
  taskId: string
  isExpanded: (pluginId: string) => boolean
  onToggle: (pluginId: string) => void
  render: (merged: MergedDossierContribution) => ReactNode
}) {
  const slot = slots[index]
  if (!slot) return <>{render(mergeDossierContributions(parts))}</>
  const { id, Component } = slot
  return (
    <Component
      taskId={taskId}
      expanded={isExpanded(id)}
      onToggle={() => onToggle(id)}
    >
      {contribution => (
        <DossierChain
          slots={slots}
          index={index + 1}
          parts={[...parts, { id, contribution }]}
          taskId={taskId}
          isExpanded={isExpanded}
          onToggle={onToggle}
          render={render}
        />
      )}
    </Component>
  )
}

/**
 * The `task.dossier` slot: collects every installed plugin's contribution
 * and renders `children` with the merge (with no plugin: nothing present,
 * zero blocking, no rows).
 */
export function PluginTaskDossier({
  taskId,
  isExpanded,
  onToggle,
  children,
  plugins = INSTALLED_CLIENT_PLUGINS,
}: {
  taskId: string
  isExpanded: (pluginId: string) => boolean
  onToggle: (pluginId: string) => void
  children: (merged: MergedDossierContribution) => ReactNode
  /** Tests only; defaults to the installed list. */
  plugins?: readonly LumoClientPlugin[]
}) {
  return (
    <DossierChain
      slots={slotComponents(plugins, 'task.dossier')}
      index={0}
      parts={[]}
      taskId={taskId}
      isExpanded={isExpanded}
      onToggle={onToggle}
      render={children}
    />
  )
}
