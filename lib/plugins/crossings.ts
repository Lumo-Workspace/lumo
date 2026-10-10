/**
 * LUM-1063 (RFC §3.4 "越界检测器") — the core side of the boundary-crossing
 * extension points. Thin readers over the registry; the semantics of each
 * point are documented on its interface in `./crossing-types`.
 *
 * A project has one policy, so the FIRST registered `PolicyRuleSource` and
 * the FIRST registered `CrossingExplainer` answer; detectors all run, in
 * registration order.
 */
import { getPluginRegistry } from './registry'
import type {
  CrossingDetector,
  CrossingExplainer,
  PolicyRuleSource,
} from './crossing-types'

/** The detectors plugins registered (the core's own run first, separately). */
export function pluginCrossingDetectors(): readonly CrossingDetector[] {
  return getPluginRegistry().crossingDetectors
}

/** The SYSTEM crossing explainer, or null when no plugin provides one. */
export function crossingExplainer(): CrossingExplainer | null {
  return getPluginRegistry().crossingExplainers[0] ?? null
}

/** The project policy rule source, or null when no plugin provides one. */
export function policyRuleSource(): PolicyRuleSource | null {
  return getPluginRegistry().policyRuleSources[0] ?? null
}
