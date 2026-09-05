import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" {...props}>
      {children}
    </svg>
  );
}

export function MenuIcon() {
  return (
    <Icon stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function PlusIcon() {
  return (
    <Icon stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function SendIcon() {
  return (
    <Icon stroke="currentColor" strokeWidth="2">
      <path d="m4 4 17 8-17 8 3-8-3-8Z" />
      <path d="M7 12h14" />
    </Icon>
  );
}

export function StopIcon() {
  return (
    <Icon fill="currentColor">
      <rect height="12" rx="2" width="12" x="6" y="6" />
    </Icon>
  );
}

export function SunIcon() {
  return (
    <Icon stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon() {
  return (
    <Icon stroke="currentColor" strokeWidth="2">
      <path d="M20 15.2A8 8 0 0 1 8.8 4 8 8 0 1 0 20 15.2Z" />
    </Icon>
  );
}
