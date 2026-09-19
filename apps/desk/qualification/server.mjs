import { createServer } from "node:http";
import next from "next";

const app = next({ dev: false, dir: process.argv[2], hostname: "127.0.0.1" });
await app.prepare();
const server = createServer(app.getRequestHandler());
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
process.send({ port: server.address().port });
async function close() {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  process.exit(0);
}
process.once("SIGTERM", close);
process.once("SIGINT", close);
