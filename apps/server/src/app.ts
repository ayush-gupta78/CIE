import Fastify from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { registerRepositoryRoutes, RepoError } from "./repository.js";
import type { ProviderCaller } from "./aiProvider.js";

export function createApp(
  providerCall?: ProviderCaller,
  staticRoot?: string,
  pairingSecret = randomBytes(32).toString("base64url"),
) {
  const app = Fastify({
    logger: { serializers: { req: (req) => ({ method: req.method }) } },
  });
  const sessions = new Map<string, { csrf: string; expires: number }>();
  let failures = 0;
  let lockedUntil = 0;
  const cookie = (token: string, age: number) =>
    `cie_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
  const same = (left: string, right: string) => {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const authError = (
    reply: import("fastify").FastifyReply,
    status: number,
    code: string,
  ) =>
    reply
      .code(status)
      .send({ error: { code, message: "Authorization required." } });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    if (staticRoot)
      reply.header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      );
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
  // Use the matched route, never the raw URL: Fastify decodes percent-encoded
  // segments before dispatch, so raw-path checks can skip a privileged handler.
  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (
      !route?.startsWith("/api/v1/") ||
      ["/api/v1/health", "/api/v1/auth/pair"].includes(route)
    )
      return;
    const token = /(?:^|;\s*)cie_session=([A-Za-z0-9_-]+)(?:;|$)/.exec(
      request.headers.cookie ?? "",
    )?.[1];
    const session = sessions.get(token ?? "");
    if (!session || session.expires <= Date.now()) {
      if (token) sessions.delete(token);
      return authError(reply, 401, "AUTH_REQUIRED");
    }
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !same(String(request.headers["x-cie-csrf"] ?? ""), session.csrf)
    )
      return authError(reply, 403, "CSRF_DENIED");
  });

  app.post("/api/v1/auth/pair", async (request, reply) => {
    if (Date.now() < lockedUntil)
      return authError(reply, 429, "AUTH_THROTTLED");
    const body = request.body;
    const secret =
      body && typeof body === "object" && "secret" in body ? body.secret : null;
    if (typeof secret !== "string" || !same(secret, pairingSecret)) {
      if (++failures >= 5) {
        lockedUntil = Date.now() + 60_000;
        failures = 0;
      }
      return authError(reply, 401, "AUTH_REQUIRED");
    }
    failures = 0;
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    for (const [key, session] of sessions)
      if (session.expires <= Date.now()) sessions.delete(key);
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
    sessions.set(token, { csrf, expires: Date.now() + 8 * 60 * 60_000 });
    reply.header("Set-Cookie", cookie(token, 8 * 60 * 60));
    return { csrf };
  });
  app.get("/api/v1/auth/session", async (request) => {
    const token = /(?:^|;\s*)cie_session=([A-Za-z0-9_-]+)(?:;|$)/.exec(
      request.headers.cookie ?? "",
    )?.[1];
    return { csrf: sessions.get(token ?? "")!.csrf };
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = /(?:^|;\s*)cie_session=([A-Za-z0-9_-]+)(?:;|$)/.exec(
      request.headers.cookie ?? "",
    )?.[1];
    if (token) sessions.delete(token);
    reply.header("Set-Cookie", cookie("", 0));
    return { loggedOut: true };
  });

  app.get("/api/v1/health", async () => ({
    status: "ok" as const,
    mode: "local" as const,
    version: "0.1.0",
  }));

  registerRepositoryRoutes(app, providerCall);
  if (staticRoot) {
    const root = resolve(staticRoot);
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".json": "application/json",
    };
    const serve = async (
      request: { url: string },
      reply: {
        code: (status: number) => typeof reply;
        type: (type: string) => typeof reply;
        send: (body: Buffer | object) => unknown;
      },
    ) => {
      const pathname = request.url.split("?", 1)[0];
      let name: string;
      try {
        name = decodeURIComponent(pathname);
      } catch {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Asset not found." } });
      }
      const segments = name.split("/").filter(Boolean);
      if (
        segments.some(
          (segment) =>
            segment === ".." ||
            segment === "." ||
            segment.includes("\\") ||
            segment.includes("\0"),
        )
      )
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Asset not found." } });
      const file = resolve(
        root,
        ...(segments.length ? segments : ["index.html"]),
      );
      const mime = types[extname(file)];
      try {
        const canonical = await realpath(file);
        const within = relative(root, canonical);
        if (
          !mime ||
          within.startsWith(`..${sep}`) ||
          within === ".." ||
          resolve(root) === canonical
        )
          throw new Error("Asset outside build");
        return reply.type(mime).send(await readFile(canonical));
      } catch {
        return reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "Asset not found." } });
      }
    };
    app.get("/", serve);
    app.get("/*", serve);
  }
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
