import { PlanRunGate } from '../../components/plan-run/PlanRunGate'

/**
 * Converter gate page — the CLI deep-link target (`lumo plan` / `lumo plan
 * status` print `/workspace/<slug>/plan/<runId>`). Auth + workspace access are
 * validated by the parent WorkspaceLayout; react-query + i18n come from the
 * root providers. The client dispatcher renders whichever gate is open by the
 * run's stage (Gate B · 对齐 / Gate C · 物化).
 */
export default async function PlanRunGatePage({
  params,
}: {
  params: Promise<{ workspaceUrl: string; runId: string }>
}) {
  const { workspaceUrl, runId } = await params
  return <PlanRunGate runId={runId} workspaceUrl={workspaceUrl} />
}
