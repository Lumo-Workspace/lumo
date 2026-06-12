/**
 * Project task-detail page:
 * /workspace/[slug]/projects/[projectSlug]/tasks/LUM-2[/<tab>]
 *
 * Empty leaf by design (LUM-460 Option B): the task fetch + presence + render
 * live in the sibling `[identifier]/layout.tsx`, which stays mounted across tab
 * switches so a tab navigation re-runs no server work here. Unlike my-tasks,
 * this route has no ownership redirect, so the page renders nothing.
 */
export default function ProjectTaskIdentifierPage() {
  return null
}
