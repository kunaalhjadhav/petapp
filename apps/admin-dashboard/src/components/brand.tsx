export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--color-teal)" />
      <g fill="#fff">
        <ellipse cx="16" cy="20" rx="6" ry="5" />
        <circle cx="9.5" cy="13" r="2.4" />
        <circle cx="13.5" cy="9.5" r="2.4" />
        <circle cx="18.5" cy="9.5" r="2.4" />
        <circle cx="22.5" cy="13" r="2.4" />
      </g>
    </svg>
  );
}
