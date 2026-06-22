/**
 * Brand and UI icons for the Lumo marketing homepage.
 *
 * These are inline SVGs lifted from the homepage design (Lumo Homepage.dc.html)
 * rather than the app's product icon set — the marketing surface is an
 * intentional brand fork, so it carries its own self-contained glyphs. All use
 * `currentColor` so callers control fill via CSS.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** The Lumo logomark — a circle over an L formed by two bars. */
export function LumoMark({ size = 24, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 400 400'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='280' cy='120' r='120' fill='currentColor' />
      <rect width='80' height='400' fill='currentColor' />
      <rect
        y='400'
        width='80'
        height='400'
        transform='rotate(-90 0 400)'
        fill='currentColor'
      />
    </svg>
  )
}

export function GitHubIcon({ size = 21, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z'
        fill='currentColor'
      />
    </svg>
  )
}

export function ClaudeIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 1200 1200'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        fill='currentColor'
        d='M233.96 800.21L468.64 668.54l3.95-11.44-3.95-6.36-11.44 0-39.22-2.42-134.09-3.62-116.3-4.83-112.67-6.04-28.35-6.04L0 592.75l2.74-17.48 23.84-16.03 34.15 2.98 75.46 5.15 113.24 7.81 82.15 4.83 121.69 12.65 19.33 0 2.74-7.81-6.6-4.83-5.15-4.83L346.39 495.79 219.54 411.87l-66.44-48.32-35.92-24.48-18.12-22.95-7.81-50.09 32.62-35.92 43.81 2.98 11.19 2.98 44.38 34.15 94.79 73.37 123.79 91.17 18.12 15.06 7.25-5.15.89-3.63-8.13-13.62-67.46-121.69-71.84-123.79-31.97-51.3-8.46-30.77c-2.98-12.64-5.15-23.27-5.15-36.24l37.13-50.42 20.54-6.6 49.53 6.6 20.86 18.12 30.77 70.39 49.85 110.82 77.32 150.68 22.63 44.7 12.08 41.4 4.51 12.64h7.81v-7.25l6.36-84.89 11.76-104.21 11.44-134.09 3.94-37.77 18.68-45.26 37.13-24.48 28.99 13.85 23.84 34.15-3.3 22.07-14.17 92.13-27.79 144.32-18.12 96.64 10.55 0 12.08-12.08 48.89-64.91 82.15-102.68 36.24-40.75 42.28-45.02 27.14-21.42 51.3 0 37.77 56.13-16.91 57.99-52.83 67.01-43.82 56.78-62.82 84.56-39.22 67.65 3.62 5.4 9.34-0.89 141.91-30.2 76.67-13.85 91.49-15.7 41.4 19.33 4.51 19.65-16.27 40.19-97.85 24.16-114.77 22.95-170.9 40.43-2.09 1.53 2.42 2.98 76.99 7.25 32.94 1.77 80.62 0 150.12 11.19 39.22 25.93 23.52 31.73-3.95 24.16-60.4 30.77-81.5-19.33-190.23-45.26-65.46-16.27-9.02 0v5.4l54.36 53.15 99.62 89.96 124.75 115.97 6.36 28.67-16.03 22.63-16.91-2.42-109.61-82.47-42.28-37.13-95.76-80.62-5.66 0v8.46l22.07 32.3 116.54 175.17 6.04 53.72-8.46 17.48-30.2 10.55-33.18-6.04-68.21-95.76-70.39-107.84-56.78-96.64-6.93 3.95-33.5 360.89-15.7 18.44-36.24 13.85-30.2-22.95-16.03-37.13 16.03-73.37 19.33-95.76 15.7-76.11 14.17-94.55 8.46-31.41-.56-2.09-6.93.89-71.28 97.85-108.4 146.5-85.77 91.81-20.54 8.13-35.6-18.44 3.3-32.94 19.14-29.32 118.69-150.91 71.6-93.58 46.23-50.19-.32-7.81-2.74 0L205.29 929.4l-56.13 7.25-24.16-22.63 2.98-37.13 11.44-12.08 94.79-65.24-.32.32z'
      />
    </svg>
  )
}

export function SlackIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        d='M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313z'
        fill='currentColor'
      />
      <path
        d='M8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312z'
        fill='currentColor'
      />
      <path
        d='M18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 01-2.522 2.521 2.527 2.527 0 01-2.521-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.521 2.522v6.312z'
        fill='currentColor'
      />
      <path
        d='M15.165 18.956a2.528 2.528 0 012.521 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.521-2.522v-2.522h2.521zm0-1.27a2.527 2.527 0 01-2.521-2.522 2.527 2.527 0 012.521-2.521h6.313A2.528 2.528 0 0124 15.165a2.528 2.528 0 01-2.522 2.521h-6.313z'
        fill='currentColor'
      />
    </svg>
  )
}

export function NotionIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M14.672 2.208l-10.213.74C3.507 3.06 3.208 3.644 3.208 4.284v11.498c0 .497.178.923.62 1.49l2.477 3.224c.408.527.78.64 1.558.605l12.403-.703c1.045-.07 1.344-.549 1.344-1.367V5.946c0-.378-.136-.5-.578-.854l-.138-.072-3.26-2.279c-.79-.568-1.111-.64-2.368-.533l.006-.037zM7.823 6.17c-1.007.063-1.236.077-1.808-.39L4.604 4.605c-.152-.176-.072-.39.3-.425l9.745-.711c.897-.072 1.344.248 1.69.497l1.558 1.1c.072.034.25.248.036.248l-10.075.605-.035.25zm-.82 13.475V7.73c0-.497.15-.711.61-.747l11.212-.64c.443-.035.645.249.645.711v11.842c0 .497-.072.89-.714.926l-10.717.604c-.641.036-.929-.177-1.036-.747v-.034zm10.609-11.311c.072.319 0 .64-.322.674l-.535.108v8.744c-.465.248-.893.39-1.25.39-.573 0-.715-.178-1.144-.712l-3.507-5.505v5.328l1.111.248s0 .64-.893.64l-2.44.143c-.073-.143 0-.497.25-.568l.644-.177V9.19l-.893-.07c-.072-.32.107-.782.608-.818l2.62-.178 3.65 5.577v-4.937l-.929-.107c-.072-.39.214-.674.572-.71l2.655-.178.003.035-.002-.001z'
        fill='currentColor'
      />
    </svg>
  )
}

export function FigmaIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M8.5 2h3.5v7H8.5a3.5 3.5 0 110-7z' fill='currentColor' />
      <path d='M12 2h3.5a3.5 3.5 0 110 7H12V2z' fill='currentColor' />
      <path d='M12 9.5h3.5a3.5 3.5 0 110 7H12v-7z' fill='currentColor' />
      <path
        d='M5 19.5a3.5 3.5 0 013.5-3.5H12v3.5a3.5 3.5 0 11-7 0z'
        fill='currentColor'
      />
      <path
        d='M5 12.5A3.5 3.5 0 018.5 9H12v7H8.5A3.5 3.5 0 015 12.5z'
        fill='currentColor'
      />
    </svg>
  )
}

export function DriveIcon({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='M2 14.5l3.373 6.5h13.254L22 14.5H2z' fill='currentColor' />
      <path
        d='M8.627 2.5L2 14.5l3.373 6.5L15.373 2.5H8.627z'
        fill='currentColor'
        opacity='0.7'
      />
      <path
        d='M15.373 2.5L8.627 2.5 15.373 14.5H22L15.373 2.5z'
        fill='currentColor'
        opacity='0.45'
      />
    </svg>
  )
}

/** Spec / checklist-in-a-frame glyph used by the context source grid. */
export function SpecIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect
        x='5'
        y='3'
        width='14'
        height='18'
        rx='2.5'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path
        d='M8.5 12.5l2.2 2.2 4.6-4.9'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function DocumentIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <rect
        x='5'
        y='3'
        width='14'
        height='18'
        rx='2.5'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path
        d='M8.5 8.5h7M8.5 12h7M8.5 15.5h4'
        stroke='currentColor'
        strokeWidth='1.6'
        strokeLinecap='round'
      />
    </svg>
  )
}

export function GlobeIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='12' cy='12' r='9' stroke='currentColor' strokeWidth='2' />
      <path
        d='M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18'
        stroke='currentColor'
        strokeWidth='1.5'
      />
    </svg>
  )
}

export function PullRequestIcon({ size = 13, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <circle cx='6' cy='6' r='2.4' stroke='currentColor' strokeWidth='2' />
      <circle cx='6' cy='18' r='2.4' stroke='currentColor' strokeWidth='2' />
      <circle cx='18' cy='18' r='2.4' stroke='currentColor' strokeWidth='2' />
      <path
        d='M6 8.4v7.2M18 15.6V12a3 3 0 00-3-3h-4'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
