// Minimal stroke icon set — quiet, 1.6px hairline strokes, currentColor.

const PATHS: Record<string, JSX.Element> = {
  folder: (
    <path d="M3 7.5A2 2 0 0 1 5 5.5h4.2l1.8 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  folderOpen: (
    <>
      <path d="M3 7.5A2 2 0 0 1 5 5.5h4.2l1.8 2H19a2 2 0 0 1 2 2v.5" />
      <path d="M3.6 18.5 5.4 11a1.5 1.5 0 0 1 1.46-1.15H21l-2 7.5a1.5 1.5 0 0 1-1.45 1.15H5a1.5 1.5 0 0 1-1.4-.99z" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h6.5L19 8.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M13.5 3v5.5H19" />
    </>
  ),
  chat: (
    <path d="M21 11.8c0 3.8-4 6.7-9 6.7-1.1 0-2.1-.13-3.1-.38L4.5 19.7l1.15-2.9C4.1 15.5 3 13.8 3 11.8 3 8 7 5 12 5s9 3 9 6.8z" />
  ),
  skill: <path d="M13 2.5 4 14h6.2L11 21.5 20 10h-6.2z" />,
  devices: (
    <>
      <rect x="2.5" y="4.5" width="14" height="10" rx="1.6" />
      <path d="M7 18.5h5" />
      <path d="M9.5 14.5v4" />
      <rect x="16.5" y="10.5" width="5.2" height="9" rx="1.4" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="9" r="2.4" />
      <circle cx="10" cy="18" r="2.4" />
      <path d="M8.2 7 15.7 8.6M7 8.2l2.2 7.5M16.3 10.9l-4.4 5.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
};

export function Icon({ name, size = 17 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name] ?? PATHS.file}
    </svg>
  );
}
