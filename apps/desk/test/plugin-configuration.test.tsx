import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginConfigurationCard } from "@/components/shell/plugin-configuration";
import { browserAdmissionNames } from "@/server/admission";
import { createPluginConfiguration } from "@/server/plugin-configuration";
import type {
  PluginConfiguration,
  PluginDeclaration,
} from "@/server/plugin-configuration-contract";
import { createPluginConfigurationRoutes } from "@/server/plugin-configuration-routes";

const origin = "http://127.0.0.1:43121";
const token = "T".repeat(43);
const bearer = "B".repeat(43);
const secret = "synthetic-provider-token-0001";
const contact = "Example Person person@example.org";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

const tokenField = {
  key: "example_api_token",
  kind: "secret",
  label: "Example API token",
  help: "Your plan decides which datasets are available.",
  required: true,
} as const;
const contactField = {
  key: "filings_identity",
  kind: "identity",
  label: "Filings contact",
  help: "Name email@example.org",
  required: false,
} as const;
const declared: PluginDeclaration[] = [
  {
    plugin: "example-prices",
    name: "Example prices",
    description: "Synthetic prices.",
    check: "check_configuration",
    fields: [tokenField, contactField],
  },
  {
    plugin: "example-news",
    name: "Example news",
    description: "",
    fields: [{ ...tokenField, required: false }],
  },
];

function harness(declarations = declared) {
  const configRoot = mkdtempSync(join(tmpdir(), "pythia-plugin-config-"));
  chmodSync(configRoot, 0o700);
  roots.push(configRoot);
  writeFileSync(
    join(configRoot, "secrets.json"),
    JSON.stringify({ schema_version: 1, hermes_api_key: bearer }),
    { mode: 0o600 },
  );
  const reader = vi.fn(async () => declarations);
  const transport = vi.fn(async () =>
    JSON.stringify({ schema_version: 1, data: { status: "valid" } }),
  );
  const routes = createPluginConfigurationRoutes(
    createPluginConfiguration({
      configRoot,
      environment: {} as NodeJS.ProcessEnv,
      declarations: reader,
      transport,
      now: () => new Date("2026-09-25T10:00:00.000Z"),
    }),
  );
  const json = (file: string) =>
    JSON.parse(readFileSync(join(configRoot, file), "utf8"));
  return { configRoot, json, reader, routes, transport };
}

const read = () =>
  new Request(`${origin}/api/settings/plugins`, {
    headers: { host: "127.0.0.1:43121", origin },
  });
function mutation(path: string, body: unknown, method = "PATCH") {
  return new Request(`${origin}${path}`, {
    body: JSON.stringify(body),
    method,
    headers: {
      host: "127.0.0.1:43121",
      origin,
      "content-type": "application/json",
      cookie: `${browserAdmissionNames.sessionCookie}=${token}`,
      [browserAdmissionNames.csrfHeader]: token,
    },
  });
}
const save = (plugin: string, key: string, value: unknown) =>
  mutation("/api/settings/plugins", { plugin, key, value });
const check = (plugin: string) =>
  mutation("/api/settings/plugins/check", { plugin }, "POST");

describe("plugin configuration routes", () => {
  it("stores values in custody and returns secrets as readiness only", async () => {
    const { routes, json } = harness();
    const listed = async () => {
      const text = await (await routes.pluginConfiguration(read())).text();
      expect(text).not.toContain(secret);
      expect(text).not.toContain(bearer);
      return JSON.parse(text).plugins as PluginConfiguration[];
    };
    expect((await listed()).map((plugin) => plugin.status)).toEqual([
      "ready", // news: nothing required
      "needs_configuration", // prices: the token is required
    ]);

    const saved = await routes.setPluginConfiguration(
      save("example-prices", "example_api_token", ` ${secret} `),
    );
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(secret);
    await routes.setPluginConfiguration(
      save("example-prices", "filings_identity", contact),
    );
    // Existing custody fields survive; values land in their kind's store.
    expect(json("secrets.json")).toEqual({
      schema_version: 1,
      hermes_api_key: bearer,
      example_api_token: secret,
    });
    expect(json("settings.json")).toEqual({
      schema_version: 1,
      filings_identity: contact,
    });

    const [news, prices] = await listed();
    expect(news?.fields).toEqual([
      { ...tokenField, required: false, status: "configured" },
    ]);
    expect(prices).toEqual({
      plugin: "example-prices",
      name: "Example prices",
      description: "Synthetic prices.",
      status: "ready",
      fields: [
        { ...tokenField, status: "configured" },
        { ...contactField, status: "configured", value: contact },
      ],
      can_check: true,
      check: null,
    });

    const removed = await routes.setPluginConfiguration(
      save("example-news", "example_api_token", null),
    );
    expect((await removed.json()).plugin.fields[0].status).toBe("missing");
    expect(json("secrets.json")).toEqual({
      schema_version: 1,
      hermes_api_key: bearer,
    });
  });

  it("writes only declared fields with valid values", async () => {
    const { routes, json, configRoot } = harness([
      ...declared,
      // A declaration cannot claim core custody even if a reader let it through.
      {
        plugin: "hostile",
        name: "Hostile",
        description: "",
        fields: [{ ...tokenField, key: "hermes_api_key" }],
      },
    ]);
    const cases: [unknown, number][] = [
      [
        { plugin: "example-prices", key: "undeclared_token", value: secret },
        404,
      ],
      [
        { plugin: "missing-plugin", key: "example_api_token", value: secret },
        404,
      ],
      [{ plugin: "hostile", key: "hermes_api_key", value: "replacement" }, 400],
      [
        { plugin: "example-prices", key: "configuration_checks", value: "x" },
        400,
      ],
      [
        { plugin: "example-prices", key: "example_api_token", value: "a b" },
        400,
      ],
      [
        {
          plugin: "example-prices",
          key: "filings_identity",
          value: "Name\r\nX-Injected: 1",
        },
        400,
      ],
      [{ plugin: "example-prices", key: "example_api_token", value: "" }, 400],
      [
        {
          plugin: "example-prices",
          key: "example_api_token",
          value: secret,
          extra: true,
        },
        400,
      ],
    ];
    for (const [body, status] of cases) {
      const response = await routes.setPluginConfiguration(
        mutation("/api/settings/plugins", body),
      );
      expect(response.status, JSON.stringify(body)).toBe(status);
    }
    expect(json("secrets.json")).toEqual({
      schema_version: 1,
      hermes_api_key: bearer,
    });
    expect(existsSync(join(configRoot, "settings.json"))).toBe(false);
  });

  it("rejects unadmitted callers before reading declarations or stores", async () => {
    const { routes, reader } = harness();
    const hostile = new Request(`${origin}/api/settings/plugins`, {
      body: JSON.stringify({
        plugin: "example-prices",
        key: "example_api_token",
        value: secret,
      }),
      headers: {
        "content-type": "application/json",
        host: "attacker.example:43121",
        origin: "https://attacker.example",
      },
      method: "PATCH",
    });
    expect((await routes.setPluginConfiguration(hostile)).status).toBe(403);
    const noToken = new Request(`${origin}/api/settings/plugins/check`, {
      body: JSON.stringify({ plugin: "example-prices" }),
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:43121",
        origin,
      },
      method: "POST",
    });
    expect((await routes.checkPluginConfiguration(noToken)).status).toBe(403);
    const opaqueRead = new Request(`${origin}/api/settings/plugins`, {
      headers: { host: "127.0.0.1:43121", origin: "null" },
    });
    expect((await routes.pluginConfiguration(opaqueRead)).status).toBe(403);
    expect(reader).not.toHaveBeenCalled();
  });

  it("records check outcomes for the checked values and forgets them on change", async () => {
    const { routes, transport, json, configRoot } = harness();
    expect(
      (await routes.checkPluginConfiguration(check("example-prices"))).status,
    ).toBe(409);
    expect(
      (await routes.checkPluginConfiguration(check("example-news"))).status,
    ).toBe(409);
    expect(transport).not.toHaveBeenCalled();

    await routes.setPluginConfiguration(
      save("example-prices", "example_api_token", secret),
    );
    const checked = await routes.checkPluginConfiguration(
      check("example-prices"),
    );
    expect(await checked.json()).toMatchObject({
      plugin: {
        check: { status: "valid", checked_at: "2026-09-25T10:00:00.000Z" },
      },
    });
    // The declaring plugin reads its own values; Desk never forwards them.
    expect(transport).toHaveBeenCalledWith(
      {
        plugin: "example-prices",
        operation: "check_configuration",
        arguments: {},
        readOnly: true,
      },
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(transport.mock.calls)).not.toContain(secret);
    expect(statSync(join(configRoot, "settings.json")).mode & 0o777).toBe(
      0o600,
    );

    // A failed check is not a verdict on the values.
    transport.mockRejectedValueOnce(new Error("provider unavailable"));
    const failed = await routes.checkPluginConfiguration(
      check("example-prices"),
    );
    expect((await failed.json()).plugin.check.status).toBe("error");

    // Changing a shared key through another plugin clears this plugin's check.
    await routes.setPluginConfiguration(
      save("example-news", "example_api_token", `${secret}-new`),
    );
    expect(json("settings.json")).toEqual({
      schema_version: 1,
      configuration_checks: {},
    });
  });
});

describe("plugin configuration card", () => {
  const checkButton = (markup: string) =>
    markup.match(/<button[^>]*>Check<\/button>/u)?.[0] ?? "";
  const plugin: PluginConfiguration = {
    plugin: "example-prices",
    name: "Example prices",
    description: "Synthetic prices.",
    status: "needs_configuration",
    fields: [
      { ...tokenField, status: "missing" },
      { ...contactField, status: "configured", value: contact },
    ],
    can_check: true,
    check: null,
  };
  const render = (overrides: Partial<PluginConfiguration> = {}) =>
    renderToStaticMarkup(
      <PluginConfigurationCard
        error={null}
        onCheck={vi.fn()}
        onSave={vi.fn()}
        pending={false}
        plugin={{ ...plugin, ...overrides }}
      />,
    );

  it("shows the plugin state and labels a masked secret input", () => {
    const markup = render();
    expect(markup).toContain(">Needs configuration<");
    expect(markup).toContain('for="plugin-example-prices-example_api_token"');
    expect(markup).toMatch(
      /<input(?=[^>]*id="plugin-example-prices-example_api_token")(?=[^>]*type="password")/u,
    );
    expect(markup).toMatch(
      /<input(?=[^>]*id="plugin-example-prices-filings_identity")(?=[^>]*type="text")/u,
    );
    expect(markup).toContain(`Current: ${contact}`);
    expect(checkButton(markup)).toContain('disabled=""');
  });

  it("offers the declared check once required fields are set", () => {
    const markup = render({ status: "ready" });
    expect(markup).toContain(">Ready<");
    expect(checkButton(markup)).not.toContain('disabled=""');
  });
});
