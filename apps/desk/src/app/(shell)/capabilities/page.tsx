import { Suspense } from "react";
import { CapabilitiesPage } from "@/components/capabilities/capabilities-page";

/** What Hermes can do here: skills, tools, connectors and plugins. */
export default function Capabilities() {
  return (
    <Suspense>
      <CapabilitiesPage />
    </Suspense>
  );
}
