import { createApp } from "./app.js";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const production = process.argv.includes("--production");
const webRoot = production
  ? resolve(fileURLToPath(new URL("../../web/dist/", import.meta.url)))
  : undefined;
const app = createApp(undefined, webRoot);

try {
  if (webRoot) await access(resolve(webRoot, "index.html"));
  await app.listen({ host: "127.0.0.1", port: 3001 });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => {
      process.exitCode = 0;
    });
  });
