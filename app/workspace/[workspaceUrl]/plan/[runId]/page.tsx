import { PlanRunDetail } from '../../components/plan-run/PlanRunDetail'

/**
 * Converter run page — the CLI deep-link target (`lumo plan` / `lumo plan
 * status` print `/workspace/<slug>/plan/<runId>`) and the Ideas-page
 * plan-runs surface both land here (LUM-677). Auth + workspace access are
 * validated by the parent WorkspaceLayout; react-query + i18n come from the
 * root providers. `PlanRunDetail` renders per state: an active run resumes at
 * its current gate, a terminal run shows a read-only archive.
 */
export default async function PlanRunPage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; runId: string }>
}) {
  const { workspaceUrl, runId } = await params
  return <PlanRunDetail runId={runId} workspaceUrl={workspaceUrl} />
}
