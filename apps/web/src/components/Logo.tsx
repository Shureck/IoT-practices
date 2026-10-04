export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#lg)" />
      <rect x="17" y="15" width="30" height="34" rx="5" fill="#0b1220" />
      <g stroke="#0b1220" strokeWidth="3.5" strokeLinecap="round">
        <path d="M9 23h8M9 32h8M9 41h8M47 23h8M47 32h8M47 41h8" />
      </g>
      <circle cx="32" cy="32" r="7" fill="#22d3ee" />
      <circle cx="32" cy="32" r="3" fill="#ecfeff" />
    </svg>
  );
}
