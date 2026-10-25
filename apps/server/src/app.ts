import Fastify from "fastify";

export function createApp() {
  const app = Fastify({
    logger: { serializers: { req: (req) => ({ method: req.method }) } },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (
      !["127.0.0.1:3001", "127.0.0.1:5173"].includes(request.headers.host ?? "")
    ) {
      return reply.code(403).send({
        error: { code: "UNAPPROVED_HOST", message: "Unapproved local host." },
      });
    }
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      !["http://127.0.0.1:5173", "http://127.0.0.1:3001"].includes(origin)
    ) {
      return reply.code(403).send({
        error: { code: "UNAPPROVED_ORIGIN", message: "Unapproved origin." },
      });
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers["content-type"]?.toLowerCase() !== "application/json"
    ) {
      return reply.code(415).send({
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "JSON is required for changes.",
        },
      });
    }
  });

  app.get("/api/v1/health", async () => ({
    status: "ok" as const,
    mode: "local" as const,
    version: "0.1.0",
  }));

  return app;
}
