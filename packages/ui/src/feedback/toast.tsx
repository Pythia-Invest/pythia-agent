"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import { CircleAlert, CircleCheck, CircleX, Info, X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../class-name";
import { type StatusTone, statusTones } from "./tones";

/** The four explicitly labelled Pythia toast meanings. */
export type ToastTone = StatusTone;

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

/**
 * Stacking math over the variables Base UI sets on each toast. Toasts behind
 * the frontmost one shrink and peek out by 0.75rem per index; expanding lays
 * them out with a 0.75rem gap using Base UI's measured offsets.
 *
 * Every Base UI-supplied variable carries a resting fallback. Base UI writes
 * these at runtime, so without one the declaration is invalid until the first
 * measurement, and any tool reading the compiled stylesheet sees a dangling
 * reference. The fallbacks are the single-toast resting state.
 */
const toastStack = [
  "[--toast-scale:calc(max(0,1-(var(--toast-index,0)*0.08)))]",
  "[--toast-shrink:calc(1-var(--toast-scale))]",
  "[--toast-stack-height:var(--toast-frontmost-height,var(--toast-height,auto))]",
  "[--toast-expanded-y:calc(var(--toast-offset-y,0px)*-1+var(--toast-index,0)*0.75rem*-1+var(--toast-swipe-movement-y,0px))]",
  "h-(--toast-stack-height) origin-top",
  "[transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(calc(var(--toast-swipe-movement-y,0px)-var(--toast-index,0)*0.75rem-var(--toast-shrink)*var(--toast-stack-height)))_scale(var(--toast-scale))]",
  "data-expanded:h-[var(--toast-height,auto)] data-expanded:[transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(var(--toast-expanded-y))]",
  "data-limited:opacity-0 data-ending-style:opacity-0",
  "data-starting-style:[transform:translateY(-150%)] data-ending-style:not-data-swipe-direction:[transform:translateY(-150%)]",
  "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x,0px)+150%))]",
  "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y,0px)-150%))]",
].join(" ");

function ToastQueue() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => {
    const tone = (toast.type ?? "info") as ToastTone;
    const Icon = icons[tone] ?? Info;
    return (
      <BaseToast.Root
        className={cn(
          "motion-standard absolute top-0 left-0 z-[calc(100-var(--toast-index,0))] w-full overflow-hidden rounded-container border border-border bg-overlay text-foreground shadow-popup transition-[transform,opacity,height]",
          toastStack,
        )}
        data-slot="toast"
        data-tone={tone}
        key={toast.id}
        swipeDirection={["up", "right"]}
        toast={toast}
      >
        <BaseToast.Content className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-3 p-4">
          <Icon
            aria-hidden="true"
            className={cn("mt-0.5 size-[1.125rem]", statusTones[tone].accent)}
          />
          <div className="min-w-0 text-body leading-ui">
            <BaseToast.Title className="font-semibold" />
            <BaseToast.Description className="text-foreground-secondary" />
          </div>
          {toast.actionProps ? (
            <BaseToast.Action className="inline-grid h-control cursor-pointer place-items-center rounded-control border border-primary bg-primary px-3 font-semibold text-primary-foreground hover:opacity-88" />
          ) : null}
          <BaseToast.Close
            aria-label="Dismiss notification"
            className="inline-grid size-control cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-foreground-secondary hover:bg-interaction-hover hover:text-foreground [&>svg]:size-4"
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
        <BaseToast.Viewport
          className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 z-100 m-0 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2"
          data-slot="toast-viewport"
        >
          <ToastQueue />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}
