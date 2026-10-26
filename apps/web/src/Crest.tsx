export function Crest({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M24 2 46 24 24 46 2 24 24 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M24 8 40 24 24 40 8 24 24 8Z"
        stroke="currentColor"
        strokeWidth=".6"
        opacity=".72"
      />
      <path
        d="M24 14v20M14 24h20M19 19l10 10m0-10L19 29"
        stroke="currentColor"
        strokeWidth=".75"
      />
      <circle cx="24" cy="24" r="3.2" fill="currentColor" />
    </svg>
  );
}

const icons = {
  home: (
    <>
      <path d="m3 11 9-8 9 8v9H3v-9Z" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  repository: (
    <>
      <path d="M3 5h7l2 2h9v12H3V5Z" />
      <path d="M3 10h18" />
    </>
  ),
  graph: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="15" r="1" />
      <circle cx="12" cy="9" r="1" />
      <circle cx="17" cy="14" r="1" />
      <path d="m9 14 2-4m2 0 3 3" />
    </>
  ),
  analysis: (
    <>
      <path d="M4 20V8m5 12V4m5 16v-8m5 8V6" />
    </>
  ),
  assistant: (
    <>
      <path d="M4 4h16v12H9l-5 4V4Z" />
      <path d="M12 7v6m-3-3h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
};

export function NavGlyph({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
}
