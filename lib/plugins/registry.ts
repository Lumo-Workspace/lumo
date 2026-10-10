/**
 * LUM-1061 (RFC §3.3) — the plugin registry.
 *
 * Lazy and once per process: the first `getPluginRegistry()` call walks
 * `INSTALLED_SERVER_PLUGINS` and runs every `register`; the result is cached
 * in module scope. Route handlers, services, workflow steps and crons all
 * read extension points through it — there is no global start-up order
 * (`instrumentation.ts` is not involved, so edge / self-hosted workers behave
 * the same).
 *
 * `INSTALLED_SERVER_PLUGINS` is read inside the getter, never at module load,
 * so an import cycle through a plugin back into a core service cannot see it
 * half-initialised.
 */
import { INSTALLED_SERVER_PLUGINS } from './installed'
import type {
  AgentContextContributor,
  CoreEventHandler,
  CoreEvents,
  DoneGateContributor,
  LumoServerPlugin,
  RetentionContributor,
} from './types'
import type {
  CrossingDetector,
  CrossingExplainer,
  PolicyRuleSource,
} from './crossing-types'

type EventHandlers = {
  [E in keyof CoreEvents]: CoreEventHandler<E>[]
}

export interface PluginRegistry {
  /** Ids of the registered plugins, in registration order. */
  readonly plugins: readonly string[]
  readonly doneGates: readonly DoneGateContributor[]
  readonly agentContexts: readonly AgentContextContributor[]
  readonly retention: readonly RetentionContributor[]
  // LUM-1063 (PR4): boundary crossings.
  readonly crossingDetectors: readonly CrossingDetector[]
  readonly crossingExplainers: readonly CrossingExplainer[]
  readonly policyRuleSources: readonly PolicyRuleSource[]
  handlersFor<E extends keyof CoreEvents>(
    event: E
  ): readonly CoreEventHandler<E>[]
}

/** Build a registry from an explicit plugin list (pure; used by the getter and tests). */
export function createPluginRegistry(
  plugins: readonly LumoServerPlugin[]
): PluginRegistry {
  const ids: string[] = []
  const doneGates: DoneGateContributor[] = []
  const agentContexts: AgentContextContributor[] = []
  const retention: RetentionContributor[] = []
  const crossingDetectors: CrossingDetector[] = []
  const crossingExplainers: CrossingExplainer[] = []
  const policyRuleSources: PolicyRuleSource[] = []
  const handlers: EventHandlers = {
    'github.pullRequest': [],
    'github.push': [],
    'task.prLinked': [],
    'task.statusChanged': [],
  }
  for (const plugin of plugins) {
    if (ids.includes(plugin.id))
      throw new Error(`plugin "${plugin.id}" is installed twice`)
    ids.push(plugin.id)
    plugin.register({
      doneGate: g => void doneGates.push(g),
      agentContext: c => void agentContexts.push(c),
      retention: r => void retention.push(r),
      on: (event, handler) => void handlers[event].push(handler),
      crossingDetector: d => void crossingDetectors.push(d),
      crossingExplainer: e => void crossingExplainers.push(e),
      policyRuleSource: r => void policyRuleSources.push(r),
    })
  }
  return {
    plugins: ids,
    doneGates,
    agentContexts,
    retention,
    crossingDetectors,
    crossingExplainers,
    policyRuleSources,
    handlersFor: event => handlers[event],
  }
}

let cached: PluginRegistry | null = null

/** The process-wide registry of the installed plugins. */
export function getPluginRegistry(): PluginRegistry {
  cached ??= createPluginRegistry(INSTALLED_SERVER_PLUGINS)
  return cached
}
