type Props = { size?: number; className?: string };

export default function Logo({ size = 36, className }: Props) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-label="VISP"
    >
      <defs>
        <linearGradient id="visp-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="50%" stopColor="#7850FF" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path
        d="M 20 20 L 50 80 L 80 20"
        fill="none"
        stroke="url(#visp-logo-grad)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
