import {
  ChartCandlestick,
  Eye,
  FolderOpen,
  Library,
  type LucideIcon,
  MessageCircle,
} from "lucide-react";

export interface Destination {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Routes that light this destination up beyond `href` itself. */
  matches: (pathname: string) => boolean;
}

/**
 * The desk's top-level surfaces, in the design's order.
 *
 * Only Chat has product behaviour behind it today; the rest are the placeholder
 * destinations the design reserves, and their pages say so rather than pretend
 * to hold data. Settings is not listed here because it sits in the rail footer.
 */
export const destinations: readonly Destination[] = [
  {
    id: "chat",
    label: "Chat",
    icon: MessageCircle,
    href: "/",
    matches: (pathname) => pathname === "/" || pathname.startsWith("/c/"),
  },
  {
    id: "markets",
    label: "Markets",
    icon: ChartCandlestick,
    href: "/markets",
    matches: (pathname) => pathname.startsWith("/markets"),
  },
  {
    id: "watchlist",
    label: "Watchlist",
    icon: Eye,
    href: "/watchlist",
    matches: (pathname) => pathname.startsWith("/watchlist"),
  },
  {
    id: "workspace",
    label: "Workspace",
    icon: FolderOpen,
    href: "/workspace",
    matches: (pathname) => pathname.startsWith("/workspace"),
  },
  {
    id: "filings",
    label: "Filings",
    icon: Library,
    href: "/filings",
    matches: (pathname) => pathname.startsWith("/filings"),
  },
];

/** Title shown in the top bar for the current route. */
export function destinationTitle(pathname: string) {
  if (pathname.startsWith("/settings")) return "Settings";
  return (
    destinations.find((destination) => destination.matches(pathname))?.label ??
    "Pythia"
  );
}
