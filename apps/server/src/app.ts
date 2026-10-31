import Fastify from "fastify";
import { registerRepositoryRoutes, RepoError } from "./repository.js";
import type { ProviderCaller } from "./aiProvider.js";

export function createApp(providerCall?: ProviderCaller) {
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
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers["content-type"] ?? "",
      )
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

  registerRepositoryRoutes(app, providerCall);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepoError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : null;
    const status = statusCode === 400 || statusCode === 413 ? statusCode : 500;
    return reply.code(status).send({
      error: {
        code:
          status === 400
            ? "INVALID_INPUT"
            : status === 413
              ? "REQUEST_TOO_LARGE"
              : "UNAVAILABLE",
        message:
          status === 400
            ? "Invalid request."
            : status === 413
              ? "Request is too large."
              : "Local request unavailable.",
      },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "Endpoint not found." } }),
  );

  return app;
}
