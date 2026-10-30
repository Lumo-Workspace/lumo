import type { SVGProps } from 'react'

/**
 * A neutral Feishu / Lark glyph (LUM-1341): a paper plane in the platform's
 * blue and teal. Not the trademarked logo.
 */
export function FeishuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 24 24'
      aria-hidden='true'
      {...props}
    >
      <path d='M2.5 10.6 21 3.2l-5.2 17.3-4.6-6.1z' fill='#3370ff' />
      <path d='M11.2 14.4 21 3.2 8.6 12.3z' fill='#00d6b9' />
      <path d='m8.6 12.3 2.6 2.1-1.2 4.9z' fill='#133c9a' />
    </svg>
  )
}
