"use client";

import {
  createContext,
  useCallback,
  useRef,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { closeTab } from "@/components/shell/tabs-model";
import type { DeskView } from "@/view-context/types";

export type WorkspaceLocation = {
  path: string;
  heading?: string | undefined;
  search?: { term: string; revision: string } | undefined;
};
export type ReadingPosition = {
  top: number;
  left: number;
  search?: WorkspaceLocation["search"];
  searchHit?: number | undefined;
  heading?: string | undefined;
};
export type WorkspaceReferenceAction = (
  file: NonNullable<DeskView["file"]>,
  compact?: boolean,
) => ReactNode;
type ReaderContext = {
  renderReference?: WorkspaceReferenceAction | undefined;
  artifact: WorkspaceLocation | null;
  files: readonly WorkspaceLocation[];
  closeFile: (path: string) => void;
  getReadingPosition: (path: string) => ReadingPosition | undefined;
  saveReadingPosition: (path: string, position: ReadingPosition) => void;
  open: (location: WorkspaceLocation) => void;
  close: () => void;
  closeAndFocus: (target: () => HTMLElement | null) => void;
  view: DeskView | null;
  setView: (view: DeskView | null) => void;
};
const Context = createContext<ReaderContext | null>(null);

/** Artifact placement and observable reader state only; native Chat ownership stays elsewhere. */
export function WorkspaceReaderProvider({
  children,
  renderReference,
}: {
  children: ReactNode;
  renderReference?: WorkspaceReferenceAction;
}) {
  const [tabs, setTabs] = useState<{
    activeId: string | null;
    files: WorkspaceLocation[];
  }>({ activeId: null, files: [] });
  const artifact =
    tabs.files.find((file) => file.path === tabs.activeId) ?? null;
  const positions = useRef(new Map<string, ReadingPosition>());
  const getReadingPosition = useCallback(
    (path: string) => positions.current.get(path),
    [],
  );
  const saveReadingPosition = useCallback(
    (path: string, position: ReadingPosition) => {
      positions.current.set(path, position);
    },
    [],
  );
  useEffect(() => {
    for (const path of positions.current.keys()) {
      if (!tabs.files.some((file) => file.path === path))
        positions.current.delete(path);
    }
  }, [tabs.files]);
  const [view, setView] = useState<DeskView | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const currentArtifact = useRef<WorkspaceLocation | null>(null);
  const open = useCallback((location: WorkspaceLocation) => {
    if (!currentArtifact.current)
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    currentArtifact.current = location;
    setTabs((current) => ({
      activeId: location.path,
      files: current.files.some((file) => file.path === location.path)
        ? current.files.map((file) =>
            file.path === location.path ? location : file,
          )
        : [...current.files, location],
    }));
  }, []);
  const closeAndFocus = useCallback((target: () => HTMLElement | null) => {
    currentArtifact.current = null;
    setTabs((current) => ({ ...current, activeId: null }));
    requestAnimationFrame(() => target()?.focus());
  }, []);
  const close = useCallback(
    () => closeAndFocus(() => opener.current),
    [closeAndFocus],
  );
  const closeFile = useCallback((path: string) => {
    positions.current.delete(path);
    setTabs((current) => {
      const next = closeTab(
        current.files.map((file) => file.path),
        current.activeId,
        path,
      );
      const files = current.files.filter((file) =>
        next.openIds.includes(file.path),
      );
      currentArtifact.current =
        files.find((file) => file.path === next.activeId) ?? null;
      return { activeId: next.activeId, files };
    });
  }, []);
  const value = useMemo(
    () => ({
      artifact,
      files: tabs.files,
      closeFile,
      getReadingPosition,
      saveReadingPosition,
      open,
      close,
      closeAndFocus,
      view,
      setView,
      renderReference,
    }),
    [
      artifact,
      tabs.files,
      closeFile,
      getReadingPosition,
      saveReadingPosition,
      open,
      close,
      closeAndFocus,
      view,
      renderReference,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspaceReader() {
  return useContext(Context);
}
