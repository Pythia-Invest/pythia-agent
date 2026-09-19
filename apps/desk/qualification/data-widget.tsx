import { useState } from "react";
import type { WidgetBinding, WidgetProps } from "@pythia/widget-sdk";

type ResearchData = { label: string; detail?: string };
const decode = (value: unknown) => {
  const result = value as { data?: { label?: unknown } };
  if (typeof result.data?.label !== "string")
    throw Error("Invalid research result");
  return { label: result.data.label };
};
const peerResource = {
  plugin: "synthetic-research",
  operation: "peer",
  arguments: {},
};
export const binding: WidgetBinding<
  { key?: string },
  ResearchData,
  ResearchData
> = {
  queries: (input) => [
    {
      key: ["synthetic-research", input.key ?? "summary"],
      resource: input.key
        ? peerResource
        : {
            plugin: "synthetic-research",
            operation: "summary",
            arguments: {},
          },
      ...(input.key ? { readResource: () => peerResource } : {}),
      enabled: true,
      decode,
    },
  ],
  deferred: (input, primary) =>
    input.key
      ? []
      : [
          {
            key: ["synthetic-research", "detail"],
            resource: {
              plugin: "synthetic-research",
              operation: "detail",
              arguments: {},
            },
            enabled: Boolean(primary[0]?.data),
            decode,
          },
        ],
  render: (_input, queries, details) => ({
    state: queries[0]?.data ? "ready" : queries[0]?.error ? "error" : "loading",
    data: {
      label:
        queries[0]?.data?.label ??
        (queries[0]?.error ? "Research unavailable" : "Research loading"),
      detail: queries[0]?.data ? details[0]?.data?.label : undefined,
    },
    ...(queries[0]?.error ? { message: "Research updates unavailable" } : {}),
  }),
};

export default function Research({ data }: WidgetProps<ResearchData>) {
  const [count, setCount] = useState(0);
  return (
    <div data-slot="synthetic-research" className="p-3">
      <p>{data?.label}</p>
      <p>{data?.detail}</p>
      <button type="button" onClick={() => setCount(count + 1)}>
        Notes {count}
      </button>
    </div>
  );
}
