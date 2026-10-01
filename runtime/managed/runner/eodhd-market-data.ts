/** One owned official SDK request sequence. No ambient credentials or logs. */
import { EODHDClient } from "eodhd";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { execute, type Client } from "./eodhd-market-data-operations.js";
import { record } from "./eodhd-market-data-values.js";
import { dashboard } from "./eodhd-market-data-dashboard.js";
import { failure, sdkFailure } from "./eodhd-market-data-errors.js";
import { installEodhdBudget } from "./provider-budget.js";
export { failure } from "./eodhd-market-data-errors.js";
export async function run(
  input: unknown,
  factory: (token: string) => Client = (token) =>
    new EODHDClient({
      apiToken: token,
      timeout: 10000,
      maxRetries: 0,
      logger: { debug() {}, warn() {}, error() {} },
    }),
) {
  delete process.env.EODHD_API_TOKEN;
  delete process.env.EODHD_LOG;
  try {
    const request = record(input);
    if (
      typeof request.token !== "string" ||
      !request.token ||
      typeof request.operation !== "string"
    )
      throw Error("invalid_request");
    if (request.operation === "dashboard")
      return await dashboard(
        factory(request.token),
        record(request.arguments),
        request.token,
      );
    return await execute(
      factory(request.token),
      request.operation,
      record(request.arguments),
    );
  } catch (error) {
    return failure(error);
  }
}
async function main() {
  installEodhdBudget(sdkFailure);
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw Error("invalid_request");
  }
  process.stdout.write(JSON.stringify(await run(JSON.parse(input))));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  main().catch(() => {
    process.stdout.write(JSON.stringify(failure(Error("invalid_request"))));
  });
