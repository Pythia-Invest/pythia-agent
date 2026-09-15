"use client";
import { Button, Dialog, IconButton } from "@pythia/ui";
import { Link2, MessageSquarePlus, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDeskDrafts } from "@/client/providers";
import { useSessions } from "@/client/queries";
import { parseFileReference, type FileReference } from "@/workspace/references";
import { WorkspaceReaderProvider } from "./reader-context";
type Actions = {
  register: (target: string | null, open: (target: string) => void) => void;
  reference: (file: FileReference) => void;
};
const Context = createContext<Actions | null>(null);
export function useReferenceActions() {
  return useContext(Context);
}
function ReferenceAction({
  file,
  compact = false,
}: {
  file: FileReference;
  compact?: boolean;
}) {
  const actions = useReferenceActions();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.key !== "Enter" ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest("input,textarea,[contenteditable=true]") ||
        target.closest('[data-slot="workspace-reader"]') !==
          button.current?.closest('[data-slot="workspace-reader"]')
      )
        return;
      event.preventDefault();
      actions?.reference(file);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [actions, file]);
  if (compact)
    return (
      <IconButton
        ref={button}
        label="Reference in chat"
        title="Reference this file in chat"
        className="text-foreground-secondary"
        size="sm"
        aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
        onClick={() => actions?.reference(file)}
      >
        <MessageSquarePlus className="stroke-[1.6]" />
      </IconButton>
    );
  return (
    <Button
      ref={button}
      type="button"
      size="sm"
      variant="secondary"
      aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
      onClick={() => actions?.reference(file)}
    >
      <Link2 />
      Reference in chat
    </Button>
  );
}
export function WorkspaceInteractions({ children }: { children: ReactNode }) {
  const drafts = useDeskDrafts();
  const sessions = useSessions();
  const destination = useRef<{
    target: string | null;
    open: (target: string) => void;
  }>({ target: null, open: () => {} });
  const chosenTarget = useRef<string | null>(null);
  const [pending, setPending] = useState<FileReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const insert = useCallback(
    (file: FileReference, target: string) => {
      try {
        const valid = parseFileReference(file);
        if (!valid) throw new Error("This file reference is unavailable.");
        drafts.addReference(target, valid);
        chosenTarget.current = target;
        destination.current.open(target);
        setPending(null);
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not add the reference.",
        );
      }
    },
    [drafts],
  );
  const actions = useMemo<Actions>(
    () => ({
      register: (target, open) => {
        destination.current = { target, open };
      },
      reference: (file) => {
        const target = destination.current.target;
        if (target) insert(file, target);
        else {
          setError(null);
          chosenTarget.current = null;
          setPending(file);
        }
      },
    }),
    [insert],
  );
  return (
    <Context.Provider value={actions}>
      <WorkspaceReaderProvider
        renderReference={(file, compact) => (
          <ReferenceAction file={file} compact={compact ?? false} />
        )}
      >
        {children}
      </WorkspaceReaderProvider>
      {error && !pending ? (
        <div
          data-slot="reference-error"
          role="alert"
          className="fixed right-4 bottom-4 max-w-sm rounded-container border border-error-border bg-error-surface p-3 text-error"
        >
          {error}
          <IconButton
            type="button"
            label="Dismiss reference error"
            size="sm"
            onClick={() => setError(null)}
          >
            <X />
          </IconButton>
        </div>
      ) : null}
      <Dialog.Root
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Viewport>
            <Dialog.Popup
              finalFocus={() =>
                chosenTarget.current
                  ? (document.querySelector<HTMLElement>(
                      `[data-draft-key="${CSS.escape(chosenTarget.current)}"] textarea`,
                    ) ?? false)
                  : true
              }
              data-slot="reference-target-dialog"
              className="grid max-h-[80dvh] w-[min(30rem,100%)] gap-3 overflow-auto p-5"
            >
              <Dialog.Title>Reference in chat</Dialog.Title>
              <Dialog.Description>
                Choose a conversation. Your draft will be kept and nothing is
                sent yet.
              </Dialog.Description>
              {error ? (
                <p role="alert" className="text-error">
                  {error}
                </p>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => pending && insert(pending, "new")}
              >
                New chat
              </Button>
              {sessions.data?.map((session) => (
                <Button
                  key={session.id}
                  type="button"
                  variant="ghost"
                  onClick={() => pending && insert(pending, session.id)}
                >
                  {session.title || "Untitled chat"}
                </Button>
              ))}
              {sessions.isPending ? (
                <p role="status">Loading conversations…</p>
              ) : sessions.isError ? (
                <p role="status">
                  Existing conversations are unavailable. You can use a new
                  chat.
                </p>
              ) : null}
              <Dialog.Close
                render={
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                }
              >
                Cancel
              </Dialog.Close>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </Context.Provider>
  );
}
