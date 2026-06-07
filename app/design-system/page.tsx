import { notFound } from 'next/navigation'

import { DesignSystemCatalog } from '@/components/design-system/DesignSystemCatalog'

// Dev-only: an internal token/component review surface. Never exposed in
// production (no auth, no workspace data, no need to ship it).
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <DesignSystemCatalog />
}
