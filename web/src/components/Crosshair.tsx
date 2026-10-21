/** The crosshair from the logo, drawn as a line icon. */
export function Crosshair({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="60" cy="60" r="44" strokeWidth="6" strokeDasharray="52 17" strokeLinecap="round" />
      <circle cx="60" cy="60" r="20" strokeWidth="3" opacity="0.5" />
      <path d="M60 2v26M60 92v26M2 60h26M92 60h26" strokeWidth="5" strokeLinecap="round" />
      <circle cx="60" cy="60" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}
