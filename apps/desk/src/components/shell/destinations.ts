import {
  Blocks,
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
 * Chat, Workspace and Capabilities have product behaviour behind them; the
 * rest are placeholder destinations the design reserves, and their pages say
 * so rather than pretend to hold data. Settings is not listed here because it
 * sits in the rail footer.
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
    // Instrument pages belong to Markets until it has its own overview.
    matches: (pathname) =>
      pathname.startsWith("/markets") || pathname.startsWith("/instrument/"),
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
  {
    id: "capabilities",
    label: "Capabilities",
    icon: Blocks,
    href: "/capabilities",
    matches: (pathname) => pathname.startsWith("/capabilities"),
  },
];

/** Title shown in the top bar for the current route. */
export function destinationTitle(pathname: string) {
  // Lit under Markets in the rail, but the page is an instrument.
  if (pathname.startsWith("/instrument/")) return "Instrument";
  // Repairs is a page of its own, reached from Settings; Settings is a dialog.
  if (pathname.startsWith("/settings/repairs")) return "Repairs";
  return (
    destinations.find((destination) => destination.matches(pathname))?.label ??
    "Pythia"
  );
}
