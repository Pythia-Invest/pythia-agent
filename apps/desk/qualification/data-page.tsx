"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeskProviders, useDeskApi } from "@/client/providers";
import { BoundWidget } from "@/components/widgets/bound-widget";
import { usePluginWidgetData } from "@/client/plugin-queries";
import {
  financialInput,
  type FinancialRow,
} from "@pythia/market-data/widgets/contract";

const row: FinancialRow = {
  subject: { kind: "crypto", id: "crypto:fictional" },
  symbol: "SYN",
  name: "Synthetic instrument",
  price: { mode: "preferred", criteria: { measurement: "aggregate_price" } },
  history: {
    selection: {
      mode: "preferred",
      criteria: { measurement: "aggregate_price" },
    },
    window: { kind: "rolling", days: 1 },
    completion: "any",
  },
};
const input = {
  source: { feed: "prices", subjects: [row] },
  widget: "instrument-tile",
};
const duplicateInput = {
  ...input,
  source: {
    ...input.source,
    subjects: [{ ...row, subject: { id: "crypto:fictional", kind: "crypto" } }],
  },
};

function SlowRead() {
  usePluginWidgetData(
    { plugin: "synthetic-research", operation: "slow", arguments: {} },
    true,
  );
  return <p>Slow read mounted</p>;
}
function Harness() {
  const api = useDeskApi();
  const [visible, setVisible] = useState(true);
  const [duplicate, setDuplicate] = useState(true);
  const [slow, setSlow] = useState(false);
  const [peers, setPeers] = useState(false);
  const [read, setRead] = useState("");
  const descriptor = useQuery({
    queryKey: ["synthetic-presentation"],
    queryFn: async () => {
      const response = await fetch("/api/plugins/synthetic/widgets");
      if (!response.ok) throw Error("Presentation unavailable");
      return response.json() as Promise<{
        assets: { id: string; moduleUrl: string }[];
      }>;
    },
    retry: false,
  });
  const asset = (id: string) =>
    descriptor.data?.assets.find((item) => item.id === id)?.moduleUrl;
  const financial = asset("financial"),
    research = asset("research");
  return (
    <main data-slot="data-qualification" className="p-4">
      <h1>Generic data qualification</h1>
      <button type="button" onClick={() => setVisible(!visible)}>
        Toggle all
      </button>
      <button type="button" onClick={() => setDuplicate(!duplicate)}>
        Toggle duplicate
      </button>
      <button type="button" onClick={() => setSlow(!slow)}>
        Toggle slow read
      </button>
      <button type="button" onClick={() => setPeers(!peers)}>
        Toggle peers
      </button>
      <button type="button" onClick={() => void descriptor.refetch()}>
        Refresh presentation
      </button>
      <button
        type="button"
        onClick={() => {
          const request = financialInput(row, "latest", Date.now());
          if (request)
            void Promise.all([
              api.financialRead([request]),
              api.financialPreferences(),
            ]).then(([reads, preferences]) =>
              setRead(
                `Read ${reads.length}; preference ${preferences.revision}`,
              ),
            );
        }}
      >
        Read financial snapshot
      </button>
      <p>{read}</p>
      {slow && <SlowRead />}
      {visible && !descriptor.isError && financial && research && (
        <>
          <section aria-label="Canonical">
            <BoundWidget
              moduleUrl={financial}
              name="Canonical"
              presentation="instrument-tile"
              input={input}
            />
          </section>
          {duplicate && (
            <section aria-label="Duplicate">
              <BoundWidget
                moduleUrl={financial}
                name="Duplicate"
                presentation="instrument-tile"
                input={duplicateInput}
              />
            </section>
          )}
          {peers &&
            ["A", "B"].map((key) => (
              <section key={key} aria-label={`Peer ${key}`}>
                <BoundWidget
                  moduleUrl={research}
                  name={`Peer ${key}`}
                  input={{ key }}
                />
              </section>
            ))}
          <section aria-label="Research">
            <BoundWidget moduleUrl={research} name="Research" input={{}} />
          </section>
        </>
      )}
      {descriptor.isError && <p>Presentation unavailable</p>}
    </main>
  );
}
export default function DataQualification() {
  return (
    <DeskProviders>
      <Harness />
    </DeskProviders>
  );
}
