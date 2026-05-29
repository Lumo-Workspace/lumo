interface Props {
  size?: number
  className?: string
}

// Claude sunburst mark: 12 faceted blunt-tip blades around a solid core,
// hand-drawn feel matching the Claude app icon. fill=currentColor so
// AgentBadge controls the brand color.
export function ClaudeCodeIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M8.34 7.55L8.92 1.35L8.44 0.80L7.56 0.80L7.08 1.35L7.66 7.55ZM8.48 7.75L11.55 3.28L11.45 2.59L10.76 2.21L10.12 2.49L7.96 7.46ZM8.56 8.07L14.31 5.42L14.54 4.73L14.10 3.97L13.39 3.83L8.22 7.48ZM8.46 8.28L13.77 8.60L14.31 8.16L14.28 7.40L13.72 7.00L8.44 7.68ZM8.24 8.50L13.45 11.92L14.15 11.76L14.56 11.00L14.29 10.33L8.55 7.92ZM7.97 8.54L10.31 13.44L10.96 13.69L11.63 13.28L11.72 12.59L8.49 8.23ZM7.67 8.45L7.10 14.55L7.57 15.10L8.43 15.10L8.90 14.55L8.33 8.45ZM7.52 8.24L4.43 12.58L4.52 13.26L5.18 13.65L5.82 13.38L8.03 8.54ZM7.45 7.94L1.70 10.60L1.46 11.28L1.89 12.02L2.60 12.15L7.78 8.51ZM7.56 7.69L2.07 7.08L1.51 7.49L1.49 8.28L2.04 8.72L7.54 8.29ZM7.78 7.49L2.92 3.92L2.22 4.03L1.78 4.76L2.02 5.43L7.45 8.04ZM8.03 7.46L5.82 2.62L5.18 2.35L4.52 2.74L4.43 3.42L7.52 7.76ZM8 6.4A1.6 1.6 0 108 9.6 1.6 1.6 0 008 6.4Z' />
    </svg>
  )
}
