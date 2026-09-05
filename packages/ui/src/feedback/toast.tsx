"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** The four explicitly labelled Pythia toast meanings. */
export type ToastTone = "info" | "success" | "warning" | "error";

/** A Pythia toast message passed through the native Base UI manager. */
export interface ToastMessage {
  title: ReactNode;
  description?: ReactNode;
  actionProps?: ComponentPropsWithoutRef<"button">;
  timeout?: number;
  priority?: "low" | "high";
  onClose?: () => void;
  onRemove?: () => void;
}

/** An update to an existing native toast, optionally changing its semantic tone. */
export interface ToastUpdate extends Partial<ToastMessage> {
  tone?: ToastTone;
}

/** Native promise messages transformed into info, success, and error toast states. */
export interface ToastPromiseMessages<Value> {
  loading: ToastMessage;
  success: ToastMessage | ((value: Value) => ToastMessage);
  error: ToastMessage | ((error: unknown) => ToastMessage);
}

const nativeToastManager = BaseToast.createToastManager();

function message(tone: ToastTone, input: ToastMessage) {
  return { ...input, type: tone };
}

function resolvedMessage<Value>(
  tone: ToastTone,
  input: ToastMessage | ((value: Value) => ToastMessage),
) {
  return typeof input === "function"
    ? (value: Value) => message(tone, input(value))
    : message(tone, input);
}

/**
 * Creates and manages globally rendered Pythia toasts through Base UI's one
 * native manager and queue. `info`, `success`, `warning`, and `error` add
 * separate semantic messages; typed `actionProps`, `update`, `close`, and
 * `promise` retain native action, timing, pause, swipe, and announcement
 * behavior in Public/Product and light/dark. Do mount one PythiaToastProvider;
 * don't build another queue or use toasts for durable workflow state.
 */
export const pythiaToast = {
  info(input: ToastMessage) {
    return nativeToastManager.add(message("info", input));
  },
  success(input: ToastMessage) {
    return nativeToastManager.add(message("success", input));
  },
  warning(input: ToastMessage) {
    return nativeToastManager.add(message("warning", input));
  },
  error(input: ToastMessage) {
    return nativeToastManager.add(message("error", input));
  },
  update(id: string, input: ToastUpdate) {
    const { tone, ...updates } = input;
    nativeToastManager.update(id, {
      ...updates,
      ...(tone ? { type: tone } : {}),
    });
  },
  close(id?: string) {
    nativeToastManager.close(id);
  },
  promise<Value>(
    promise: Promise<Value>,
    messages: ToastPromiseMessages<Value>,
  ) {
    return nativeToastManager.promise(promise, {
      loading: message("info", messages.loading),
      success: resolvedMessage("success", messages.success),
      error: resolvedMessage("error", messages.error),
    });
  },
};

/** Props for the single application-level Pythia toast renderer. */
export interface PythiaToastProviderProps {
  children?: ReactNode;
  timeout?: number;
  limit?: number;
  portalContainer?: HTMLElement | ShadowRoot | null;
}

const icons = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
} as const;

function ToastQueue() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => {
    const tone = (toast.type ?? "info") as ToastTone;
    const Icon = icons[tone] ?? Info;
    return (
      <BaseToast.Root
        className="py-toast"
        data-tone={tone}
        key={toast.id}
        swipeDirection={["up", "right"]}
        toast={toast}
      >
        <BaseToast.Content className="py-toast__content">
          <Icon aria-hidden="true" className="py-toast__icon" />
          <div className="py-toast__copy">
            <BaseToast.Title className="py-toast__title" />
            <BaseToast.Description className="py-toast__description" />
          </div>
          {toast.actionProps ? (
            <BaseToast.Action className="py-toast__action" />
          ) : null}
          <BaseToast.Close
            aria-label="Dismiss notification"
            className="py-toast__close"
          >
            <X aria-hidden="true" />
          </BaseToast.Close>
        </BaseToast.Content>
      </BaseToast.Root>
    );
  });
}

/**
 * Mounts the single Base UI Provider, Portal, Viewport, and native toast queue
 * for the Pythia facade. Timeout and limit preserve Base UI states; semantic
 * tokens adapt the renderer across Public/Product and light/dark, while Base UI
 * owns announcements, action and close keyboard focus, pause, swipe, and
 * dismissal. Do mount it once near the application root; don't nest providers
 * or render a second list.
 */
export function PythiaToastProvider({
  children,
  timeout,
  limit,
  portalContainer,
}: PythiaToastProviderProps) {
  return (
    <BaseToast.Provider
      limit={limit}
      timeout={timeout}
      toastManager={nativeToastManager}
    >
      {children}
      <BaseToast.Portal container={portalContainer}>
        <BaseToast.Viewport className="py-toast__viewport">
          <ToastQueue />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
