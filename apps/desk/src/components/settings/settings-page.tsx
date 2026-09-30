"use client";

import { useHermesConfig } from "@/client/hermes-settings-queries";
import { AboutPage } from "./about";
import { AccountsPage } from "./accounts";
import { ApiKeysPage } from "./api-keys";
import { AuxiliaryModels } from "./auxiliary-models";
import { FieldRows, HermesFieldsPage, SourceState } from "./config-page";
import { DataSourceSettings } from "./data-sources";
import { EndpointsPage } from "./endpoints";
import { FallbackModels, MainModelPage } from "./main-model";
import { ReferenceSettings } from "./reference";
import { RepairsPage } from "./repairs";
import type { SettingsPage } from "./sections";
import { useHermesFields } from "./use-hermes-fields";
import { usePythiaFields } from "./use-pythia-fields";

function HermesPage({ id }: { id: string }) {
  const source = useHermesFields();
  return (
    <HermesFieldsPage
      pageId={id}
      source={source}
      controls={{
        fallback_providers: (
          <FallbackModels
            value={source.values.fallback_providers}
            onChange={(value) => source.change("fallback_providers", value)}
          />
        ),
      }}
    />
  );
}

function PythiaPage({ fields }: { fields: readonly string[] }) {
  const source = usePythiaFields();
  // Browser-local fields (`desk.*`, such as the theme) never wait for the
  // device snapshot, which reads Hermes and can be slow.
  const local = fields.every((key) => key.startsWith("desk."));
  return (
    <SourceState
      source={local ? { ...source, status: "ready" } : source}
      rows={fields.length}
    >
      <FieldRows source={source} keys={fields} />
    </SourceState>
  );
}

function MainModel() {
  const source = useHermesFields();
  const config = useHermesConfig();
  return (
    <MainModelPage
      source={source}
      current={config.data?.model ?? { provider: "", model: "" }}
    />
  );
}

/** The body of one Settings page, by what kind of page it is. */
export function SettingsPageBody({ page }: { page: SettingsPage }) {
  const view = page.view;
  switch (view.kind) {
    case "hermes":
      return page.id === "model/auxiliary" ? (
        <AuxiliaryModels />
      ) : (
        <HermesPage id={page.id} />
      );
    case "pythia":
      return <PythiaPage fields={view.fields} />;
    case "main-model":
      return <MainModel />;
    case "accounts":
      return <AccountsPage />;
    case "api-keys":
      return <ApiKeysPage />;
    case "endpoints":
      return <EndpointsPage />;
    case "data-sources":
      return <DataSourceSettings />;
    case "reference":
      return <ReferenceSettings />;
    case "repairs":
      return <RepairsPage />;
    case "about":
      return <AboutPage />;
  }
}
