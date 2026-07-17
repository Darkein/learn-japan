import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  /** Taille en px (largeur = hauteur). 22 dans la BottomNav, 20 ailleurs. */
  size?: number;
}

/** Socle commun des icônes du kit (DESIGN.md §6) : trait 1.5, `currentColor`, jamais de
 * glyphes unicode/emoji au rendu variable selon la plateforme. */
function Svg({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 19V9.5l8-5.5 8 5.5V19" />
      <path d="M4 19h16" />
      <path d="M9.5 19v-6h5v6" />
    </Svg>
  );
}

export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </Svg>
  );
}

export function IconNews(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="M16 4h4v14.5" />
      <path d="M7.5 8h5v4h-5z" />
      <path d="M7.5 15h9" />
    </Svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSpeaker(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.5h3L12 5v14l-5-4.5H4a.8.8 0 0 1-.8-.8v-3.4a.8.8 0 0 1 .8-.8Z" fill="currentColor" stroke="none" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </Svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6.5" y="5" width="3.5" height="14" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.5" height="14" rx="0.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPrev(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.5 6v12L9 12l8.5-6Z" fill="currentColor" stroke="none" />
      <path d="M6.5 6v12" />
    </Svg>
  );
}

export function IconNext(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 6v12L15 12 6.5 6Z" fill="currentColor" stroke="none" />
      <path d="M17.5 6v12" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Svg>
  );
}

export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </Svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth="2.5" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

export function IconChevronUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  );
}

export function IconArrowLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v11" />
      <path d="M7 10.5l5 5 5-5" />
      <path d="M5 19.5h14" />
    </Svg>
  );
}

export function IconDownloadDone(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 10.5l4 4 8-8.5" />
      <path d="M5 19.5h14" />
    </Svg>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
    </Svg>
  );
}

export function IconInfinity(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 9a3 3 0 1 0 0 6c2 0 3-2 4-3s2-3 4-3a3 3 0 1 1 0 6c-2 0-3-2-4-3s-2-3-4-3Z" />
    </Svg>
  );
}

export function IconRepeat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 4l3 3-3 3" />
      <path d="M20 7H8a4 4 0 0 0-4 4v1" />
      <path d="M7 20l-3-3 3-3" />
      <path d="M4 17h12a4 4 0 0 0 4-4v-1" />
    </Svg>
  );
}

export function IconRepeatOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17 4l3 3-3 3" />
      <path d="M20 7H8a4 4 0 0 0-4 4v1" />
      <path d="M7 20l-3-3 3-3" />
      <path d="M4 17h12a4 4 0 0 0 4-4v-1" />
      <path d="M4 4l16 16" />
    </Svg>
  );
}
