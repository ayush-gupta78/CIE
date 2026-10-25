import Fastify from "fastify";

export function createApp() {
  const app = Fastify({ logger: true });

  app.get("/api/v1/health", async () => ({
    status: "ok" as const,
    mode: "local" as const,
    version: "0.1.0",
  }));

  return app;
}
