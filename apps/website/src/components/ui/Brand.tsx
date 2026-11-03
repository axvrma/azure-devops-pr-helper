export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15.8 3 29 26H3L15.8 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="m15.8 3 1.4 15L29 26M3 26l14.2-8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="m17.2 18 6.7 3.7" stroke="#a78bfa" strokeWidth="2" />
      <path d="m17.2 18 2.3 8" stroke="#67e8f9" strokeWidth="1.5" />
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      <span>
        prism<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
