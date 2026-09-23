import { useEffect, useState } from "react";
import type { TopBarProps } from "@pythia/widget-sdk";

/** Deliberately omits an author abort signal: the host owns module lifetime. */
export default function TopBarLifetimeProbe({ data }: TopBarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void data.transport
      .read({
        plugin: "qualification-top-bar",
        operation: "query",
        arguments: { action: "wait" },
      })
      .catch(() => {});
  }, [data.transport]);
  if (failed) throw Error("Synthetic topbar render failure");
  return (
    <div data-slot="topbar-lifetime-probe">
      <span>Custom topbar recovered</span>
      <button type="button" onClick={() => setFailed(true)}>
        Crash custom topbar
      </button>
      {data.actions}
    </div>
  );
}
