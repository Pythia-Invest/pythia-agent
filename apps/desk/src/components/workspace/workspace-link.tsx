"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileText } from "lucide-react";

import { type MouseEvent, type ReactNode, useContext } from "react";
import { ArtifactNavigationContext } from "./artifact-navigation";
import { useResolveWorkspaceHostPath } from "@/client/queries";
import { resolveWorkspaceLink, workspaceUrl } from "@/workspace/paths";
import { useWorkspaceReader, type WorkspaceLocation } from "./reader-context";

const artifactClassName =
  "inline-flex max-w-full cursor-pointer items-center gap-2 rounded-control bg-transparent px-2 py-1 align-middle font-sans text-body text-foreground no-underline outline-ring hover:bg-interaction-hover focus-visible:outline-2 disabled:cursor-default disabled:opacity-disabled";

function ArtifactLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0 text-foreground-secondary"
      />
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
}

export function plainLinkClick(event: MouseEvent) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
export function WorkspaceLink({
  location,
  children,
  onOpen,
  artifact = false,
  onIntent,
  activation = "single",
  onSelect,
}: {
  location: WorkspaceLocation;
  children: ReactNode;
  onOpen?: ((location: WorkspaceLocation) => void) | undefined;
  artifact?: boolean;
  activation?: "single" | "double";
  onSelect?: () => void;
  onIntent?: (() => void) | undefined;
}) {
  const reader = useWorkspaceReader();
  const onArtifactNavigate = useContext(ArtifactNavigationContext);
  const pathname = usePathname();
  const chatSurface = pathname === "/" || pathname?.startsWith("/c/");
  const open = onOpen ?? (chatSurface ? reader?.open : undefined);
  return (
    <Link
      data-slot="workspace-link"
      className={artifact ? artifactClassName : undefined}
      title={artifact ? "Open file in Workspace" : undefined}
      href={workspaceUrl(location.path, location.heading)}
      onNavigate={onArtifactNavigate}
      onPointerEnter={onIntent}
      onFocus={onIntent}
      onDoubleClick={(event) => {
        if (activation === "double" && open && plainLinkClick(event)) {
          event.preventDefault();
          open(location);
        }
      }}
      onClick={(event) => {
        if (open && plainLinkClick(event)) {
          event.preventDefault();
          if (activation === "single" || event.detail === 0) open(location);
          else onSelect?.();
        }
      }}
    >
      {artifact ? <ArtifactLabel>{children}</ArtifactLabel> : children}
    </Link>
  );
}

/** Decode the URL boundary once; the server still decides canonical containment. */
export function nativePathLocator(href: string) {
  if (/^file:/i.test(href)) {
    // Empty/localhost authority refers to the Hermes host, not the browser.
    // Do not let URL normalization reinterpret remote authorities or backslashes.
    const match = /^file:\/\/(?:localhost)?(\/[^?]*)$/i.exec(href);
    if (!match?.[1]) return null;
    href = match[1];
  }
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const hash = href.indexOf("#");
  try {
    const hostPath = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    const heading =
      hash < 0 ? undefined : decodeURIComponent(href.slice(hash + 1));
    if (
      !hostPath.startsWith("/") ||
      hostPath.startsWith("//") ||
      hostPath.includes("\\") ||
      Array.from(hostPath).some((char) => char.charCodeAt(0) < 32)
    )
      return null;
    return { hostPath, heading };
  } catch {
    return null;
  }
}

function NativePathLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const resolver = useResolveWorkspaceHostPath();
  const router = useRouter();
  const pathname = usePathname();
  const reader = useWorkspaceReader();
  const onArtifactNavigate = useContext(ArtifactNavigationContext);
  const location = nativePathLocator(href);
  return (
    <span data-slot="native-workspace-link">
      <button
        className={artifactClassName}
        title="Open file in Workspace"
        type="button"
        disabled={resolver.isPending || !location}
        onClick={() =>
          location &&
          resolver.mutate(location.hostPath, {
            onSuccess: ({ path }) => {
              if (reader && (pathname === "/" || pathname?.startsWith("/c/")))
                reader.open({ path, heading: location.heading });
              else {
                router.push(workspaceUrl(path, location.heading));
                onArtifactNavigate();
              }
            },
          })
        }
      >
        <ArtifactLabel>{children}</ArtifactLabel>
      </button>
      {resolver.isError || !location ? (
        <span role="status" className="ml-2 text-foreground-secondary text-xs">
          File unavailable in Workspace.
        </span>
      ) : null}
    </span>
  );
}

/** Chat filenames are root-relative; absolute native output paths need server containment validation. */
export function ChatArtifactLink({
  href,
  children,
}: {
  href?: string | undefined;
  children?: ReactNode;
}) {
  if (!href) return <span>{children}</span>;
  if (/^file:/i.test(href))
    return <NativePathLink href={href}>{children}</NativePathLink>;
  if (href.startsWith("/") && !href.startsWith("//")) {
    if (href.startsWith("/workspace/")) {
      const location = resolveWorkspaceLink(href.slice("/workspace".length));
      if (location)
        return (
          <WorkspaceLink location={location} artifact>
            {children}
          </WorkspaceLink>
        );
    }
    return <NativePathLink href={href}>{children}</NativePathLink>;
  }
  const location = resolveWorkspaceLink(href);
  if (location)
    return (
      <WorkspaceLink location={location} artifact>
        {children}
      </WorkspaceLink>
    );
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? (
    <a
      className="text-primary underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
