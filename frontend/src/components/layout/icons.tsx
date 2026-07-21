import type { ReactNode } from 'react';

/* Inline stroke icons for the shell chrome; sized by the parent via CSS */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >{children}</svg>
  );
}

export const IconFiles = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const IconSearch = () => (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.5 16.5 21 21" />
  </Svg>
);

export const IconGit = () => (
  <Svg>
    <circle cx="6" cy="5.5" r="2.4" />
    <circle cx="6" cy="18.5" r="2.4" />
    <circle cx="18" cy="8" r="2.4" />
    <path d="M6 8v8" />
    <path d="M18 10.5c0 3.6-3.6 4.4-7 4.9" />
  </Svg>
);

export const IconFlag = () => (
  <Svg>
    <path d="M5 21V4" />
    <path d="M5 4h12l-2.5 4L17 12H5" />
  </Svg>
);

export const IconChat = () => (
  <Svg>
    <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.3 0-2.6-.3-3.7-.8L3 21l1.9-5.1a8.3 8.3 0 0 1-.9-3.7A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z" />
  </Svg>
);

export const IconSun = () => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconMoon = () => (
  <Svg>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);

export const IconExpand = () => (
  <Svg>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
  </Svg>
);

export const IconDockRight = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M14 4v16" />
  </Svg>
);

export const IconFilePlus = () => (
  <Svg>
    <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M13.5 3v5.5H19" />
    <path d="M12 12v6M9 15h6" />
  </Svg>
);

export const IconFolderPlus = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v6M9 14h6" />
  </Svg>
);

export const IconUpload = () => (
  <Svg>
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const IconChevronRight = () => (
  <Svg>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const IconChevronDown = () => (
  <Svg>
    <path d="M5 9l7 7 7-7" />
  </Svg>
);

export const IconFolder = () => (
  <Svg>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);

export const IconFile = () => (
  <Svg>
    <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M13.5 3v5.5H19" />
  </Svg>
);

export const IconHistory = () => (
  <Svg>
    <path d="M3 11a9 9 0 1 0 2.6-6.3" />
    <path d="M3 4v5h5" />
    <path d="M12 8v4l3 2" />
  </Svg>
);

export const IconChart = () => (
  <Svg>
    <path d="M4 20V10M11 20V4M18 20v-7" />
    <path d="M3 20h18" />
  </Svg>
);

export const IconGear = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

export const IconMatrix = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
  </Svg>
);

export const IconRefresh = () => (
  <Svg>
    <path d="M3 11a9 9 0 0 1 15.3-5.7L21 8" />
    <path d="M21 4v4h-4" />
    <path d="M21 13a9 9 0 0 1-15.3 5.7L3 16" />
    <path d="M3 20v-4h4" />
  </Svg>
);

export const IconSend = () => (
  <Svg>
    <path d="M12 19V6" />
    <path d="M6 12l6-6 6 6" />
  </Svg>
);

export const IconStop = () => (
  <Svg>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconCheck = () => (
  <Svg>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);

export const IconSave = () => (
  <Svg>
    <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
    <path d="M7 3v4a1 1 0 0 0 1 1h6" />
  </Svg>
);

export const IconDownload = () => (
  <Svg>
    <path d="M12 4v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const IconWrap = () => (
  <Svg>
    <path d="M3 6h18" />
    <path d="M3 12h15a3 3 0 0 1 0 6h-5" />
    <path d="M16 16l-2 2 2 2" />
    <path d="M3 18h6" />
  </Svg>
);

export const IconClose = () => (
  <Svg>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconChevronUp = () => (
  <Svg>
    <path d="M5 15l7-7 7 7" />
  </Svg>
);

export const IconRevert = () => (
  <Svg>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
  </Svg>
);

export const IconArrowRight = () => (
  <Svg>
    <path d="M4 12h15" />
    <path d="M13 6l6 6-6 6" />
  </Svg>
);

export const IconPlus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconMinus = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
);
