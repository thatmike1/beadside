// the board's few icons, drawn on one 16px grid with one stroke weight

const PATHS = {
  search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
  plus: 'M8 2.5v11M2.5 8h11',
  x: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  chevron: 'M5.5 3.5L10 8l-4.5 4.5',
} as const

export type IconName = keyof typeof PATHS

/** a stroked 16px icon that takes the current text colour */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={PATHS[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
