/**
 * The Gloss mark: a numbered region marker (the app's annotation box with its
 * "1" badge) on the brand red square. Same drawing as public/logo.svg.
 */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Gloss"
      style={{ flex: "none", display: "block" }}
    >
      <rect width="48" height="48" fill="var(--color-accent)" />
      <rect x="13" y="13" width="22" height="22" fill="none" stroke="var(--color-on-accent)" strokeWidth="4" />
      <rect x="11" y="11" width="14" height="14" fill="var(--color-on-accent)" />
      <path d="M16.5 13.7H19.5V22.3H16.5V16L14.3 17.4V15.3Z" fill="var(--color-accent)" />
    </svg>
  );
}

export const APP_NAME = "Gloss";
