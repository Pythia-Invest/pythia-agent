"use client";

import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Dialog,
  LinkButton,
  pythiaToast,
} from "@pythia/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  hermesKeys,
  useCancelSignIn,
  useDisconnectAccount,
  useProviders,
  useSignInStatus,
  useStartSignIn,
} from "@/client/hermes-settings-queries";
import { deskKeys } from "@/client/query-cache";
import type {
  AccountSignIn,
  ProviderAccount,
} from "@/server/hermes-settings-contract";
import { SourceState } from "./config-page";
import { Command } from "./command";
import { ListRow, SettingsSection } from "./primitives";

/** Hermes's device sign-in: open the provider's page and enter the code. */
function SignInDialog({
  account,
  started,
  onClose,
}: {
  account: ProviderAccount;
  started: AccountSignIn;
  onClose: () => void;
}) {
  const status = useSignInStatus(account.id, started.sessionId);
  const cancel = useCancelSignIn();
  const cache = useQueryClient();
  const state = status.data?.status ?? "pending";
  const done = state === "approved";
  const finished = useRef(false);
  useEffect(() => {
    if (!done || finished.current) return;
    finished.current = true;
    void Promise.all(
      [hermesKeys.providers, deskKeys.models].map((queryKey) =>
        cache.invalidateQueries({ queryKey }),
      ),
    );
    pythiaToast.success({ title: `Signed in to ${account.name}` });
    onClose();
  }, [done, account.name, cache, onClose]);
  const failed = state === "error" || state === "expired" || status.isError;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (open) return;
        if (!done && !failed)
          cancel.mutate({ id: account.id, sessionId: started.sessionId });
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop forceRender />
        <Dialog.Viewport>
          <Dialog.Popup className="grid w-[min(26rem,100%)] gap-4">
            <div className="grid gap-1">
              <Dialog.Title>Sign in to {account.name}</Dialog.Title>
              <Dialog.Description>
                Open the sign-in page, enter this code and approve Hermes. This
                window finishes on its own.
              </Dialog.Description>
            </div>
            {started.userCode ? (
              <p className="m-0 grid gap-1 text-center">
                <span className="text-foreground-secondary text-xs">
                  Sign-in code
                </span>
                <span className="select-all rounded-control border border-border bg-subtle py-3 font-mono font-semibold text-lg tracking-[0.2em]">
                  {started.userCode}
                </span>
              </p>
            ) : null}
            {failed ? (
              <Alert tone="error" title="Sign-in didn't finish">
                {status.data?.message ??
                  (state === "expired"
                    ? "The code expired. Close this and sign in again."
                    : "Close this and try again.")}
              </Alert>
            ) : (
              <p className="m-0 flex items-center gap-2 text-body text-foreground-secondary">
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 motion-safe:animate-spin"
                />
                Waiting for you to approve…
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                render={
                  <Button variant="ghost" size="sm" type="button">
                    {failed ? "Close" : "Cancel"}
                  </Button>
                }
              />
              <LinkButton
                size="sm"
                href={started.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open sign-in page
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </LinkButton>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AccountRow({ account }: { account: ProviderAccount }) {
  const start = useStartSignIn();
  const disconnect = useDisconnectAccount();
  const [started, setStarted] = useState<AccountSignIn | null>(null);
  const [confirming, setConfirming] = useState(false);
  const subtitle = account.connected
    ? account.source
      ? `Signed in via ${account.source}`
      : "Signed in"
    : account.flow === "device_code"
      ? "Signs in through your browser, then continues here."
      : "Signs in with a command on this device.";
  let action = null;
  if (account.connected && account.disconnectable)
    action = (
      <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
    );
  else if (!account.connected && account.flow === "device_code")
    action = (
      <Button
        size="sm"
        loading={start.isPending}
        onClick={() =>
          start.mutate(account.id, { onSuccess: (value) => setStarted(value) })
        }
      >
        Sign in
      </Button>
    );
  else if (!account.connected && account.command)
    action = <Command value={account.command} />;
  return (
    <>
      <ListRow
        title={
          <span className="flex flex-wrap items-center gap-2">
            {account.name}
            {account.connected ? (
              <Badge tone="success">
                <Check aria-hidden="true" className="size-3" /> Connected
              </Badge>
            ) : null}
          </span>
        }
        description={subtitle}
        action={action}
        below={
          start.error ? (
            <p className="m-0 mt-1 text-error text-xs">{start.error.message}</p>
          ) : null
        }
      />
      {started ? (
        <SignInDialog
          account={account}
          started={started}
          onClose={() => setStarted(null)}
        />
      ) : null}
      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop forceRender />
          <AlertDialog.Viewport>
            <AlertDialog.Popup className="grid w-[min(26rem,100%)] gap-4">
              <div className="grid gap-1">
                <AlertDialog.Title>
                  Disconnect {account.name}?
                </AlertDialog.Title>
                <AlertDialog.Description>
                  Chats can't use its models until you sign in again.
                </AlertDialog.Description>
              </div>
              <div className="flex justify-end gap-2">
                <AlertDialog.Close
                  render={
                    <Button variant="ghost" size="sm" type="button">
                      Cancel
                    </Button>
                  }
                />
                <Button
                  size="sm"
                  variant="danger"
                  loading={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(account.id, {
                      onSuccess: () => setConfirming(false),
                    })
                  }
                >
                  Disconnect
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

/**
 * Subscription sign-ins, as in Hermes Desktop's Providers › Accounts:
 * connected accounts first, the rest behind a disclosure.
 */
export function AccountsPage() {
  const providers = useProviders();
  const [more, setMore] = useState(false);
  const accounts = providers.data?.accounts ?? [];
  const connected = accounts.filter((account) => account.connected);
  const others = accounts.filter((account) => !account.connected);
  return (
    <SourceState
      source={{
        status: providers.isPending
          ? "pending"
          : providers.isError
            ? "error"
            : "ready",
        error: providers.error,
        retry: () => void providers.refetch(),
      }}
    >
      <p className="m-0 mb-4 text-body text-foreground-secondary">
        Sign in with a subscription instead of pasting an API key. Hermes runs
        the sign-in and keeps the credential on this device.
      </p>
      {connected.length ? (
        <SettingsSection title="Connected">
          <div className="grid gap-1">
            {connected.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </div>
        </SettingsSection>
      ) : null}
      {others.length ? (
        <SettingsSection
          title="Other providers"
          aside={
            connected.length ? (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={more}
                onClick={() => setMore(!more)}
              >
                {more ? "Hide" : `Show ${others.length}`}
                <ChevronDown
                  aria-hidden="true"
                  className="motion-fast size-3.5 transition-transform aria-expanded:rotate-180"
                  data-open={more}
                />
              </Button>
            ) : null
          }
        >
          {more || !connected.length ? (
            <div className="grid gap-1">
              {others.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          ) : null}
        </SettingsSection>
      ) : null}
    </SourceState>
  );
}
