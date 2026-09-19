"use client";

import { createContext, useState } from "react";
import { InstrumentPrice, useThemePreference } from "@pythia/ui";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { WidgetHost } from "@/components/widgets/widget-host";

const SharedContext = createContext("missing-host-context");
const item = {
  id: "synthetic",
  ticker: "SYN",
  price: 123.45,
  status: "live" as const,
  statusLabel: "Synthetic",
  description: "Qualification fixture",
};

function Harness() {
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(true);
  const [crash, setCrash] = useState(false);
  const [presentation, setPresentation] = useState("initial");
  const [failure, setFailure] = useState<"none" | "incompatible" | "missing">(
    "none",
  );
  const { resolvedTheme, setPreference } = useThemePreference();
  const descriptor = useQuery({
    queryKey: ["qualification-widgets"],
    queryFn: async () => {
      const response = await fetch("/api/plugins/synthetic/widgets");
      if (!response.ok) throw new Error("Presentation unavailable");
      return response.json() as Promise<{
        assets: { id: string; moduleUrl: string }[];
      }>;
    },
    retry: false,
  });
  const moduleUrl = descriptor.data?.assets.find(
    (asset) => asset.id === "probe",
  )?.moduleUrl;
  const failedUrl = descriptor.data?.assets.find(
    (asset) => asset.id === failure,
  )?.moduleUrl;
  const props = {
    options: { compact: revision > 0 },
    settings: { label: revision ? "updated" : "initial" },
    timeZone: revision ? "Europe/Brussels" : "UTC",
    locale: revision ? "fr-BE" : "en-US",
    appearance: { theme: resolvedTheme, profile: "product" as const },
    presentation,
  };
  return (
    <main
      className="bg-raised p-4 text-foreground"
      data-slot="qualification-page"
    >
      <h1>Shared widget qualification</h1>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Update props
      </button>
      <button
        type="button"
        onClick={() =>
          setPreference(resolvedTheme === "light" ? "dark" : "light")
        }
      >
        Toggle theme
      </button>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        Toggle instances
      </button>
      <button type="button" onClick={() => setCrash(true)}>
        Fail one renderer
      </button>
      <button type="button" onClick={() => setPresentation("recovered")}>
        Change presentation
      </button>
      <button type="button" onClick={() => setFailure("incompatible")}>
        Load incompatible
      </button>
      <button type="button" onClick={() => setFailure("missing")}>
        Load missing
      </button>
      <button type="button" onClick={() => void descriptor.refetch()}>
        Refresh presentation
      </button>
      <div data-testid="shared-price">
        <InstrumentPrice item={item} />
      </div>
      <SharedContext value={`host-context-${revision}`}>
        {visible && moduleUrl && !descriptor.isError
          ? [0, 1].map((index) => (
              <WidgetHost
                key={index}
                name={`Instance ${index + 1}`}
                moduleUrl={moduleUrl}
                {...props}
                data={{
                  context: SharedContext,
                  hostUseState: useState,
                  hostInstrumentPrice: InstrumentPrice,
                  item,
                  crash: index === 0 && crash,
                }}
              />
            ))
          : null}
        {failure !== "none" && failedUrl && !descriptor.isError ? (
          <WidgetHost
            name="Failure case"
            moduleUrl={failedUrl}
            {...props}
            data={{}}
          />
        ) : null}
      </SharedContext>
      {descriptor.isError ? (
        <p role="status">Presentation unavailable</p>
      ) : null}
    </main>
  );
}

export default function WidgetQualificationPage() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
}
