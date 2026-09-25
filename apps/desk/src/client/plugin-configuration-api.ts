import type {
  PluginConfiguration,
  PluginConfigurations,
} from "@/server/plugin-configuration-contract";

type JsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Plugin configuration shares Desk's browser session, admission and errors. */
export class PluginConfigurationClient {
  constructor(private readonly json: JsonRequest) {}

  list() {
    return this.json<PluginConfigurations>("/api/settings/plugins");
  }

  async set(plugin: string, key: string, value: string | null) {
    return (
      await this.json<{ plugin: PluginConfiguration }>(
        "/api/settings/plugins",
        { body: JSON.stringify({ plugin, key, value }), method: "PATCH" },
      )
    ).plugin;
  }

  async check(plugin: string) {
    return (
      await this.json<{ plugin: PluginConfiguration }>(
        "/api/settings/plugins/check",
        { body: JSON.stringify({ plugin }), method: "POST" },
      )
    ).plugin;
  }
}
