import { createApp as createProductionApp } from "./app.js";
import type { ProviderCaller } from "./aiProvider.js";

// Explicit authenticated fixture: exercises the real pairing and CSRF path, never a server bypass.
export function createApp(provider?: ProviderCaller, staticRoot?: string) {
  const app = createProductionApp(
    provider,
    staticRoot,
    "synthetic-owner-pairing-fixture",
  );
  const inject = app.inject.bind(app);
  let session: Promise<{ cookie: string; csrf: string }> | undefined;
  app.inject = (async (options: {
    headers?: Record<string, string>;
    [key: string]: unknown;
  }) => {
    session ??= (async () => {
      const result = await inject({
        method: "POST",
        url: "/api/v1/auth/pair",
        headers: { host: "127.0.0.1:3001", "content-type": "application/json" },
        payload: { secret: "synthetic-owner-pairing-fixture" },
      });
      if (result.statusCode !== 200) throw new Error("Test pairing failed");
      return {
        cookie: (result.headers["set-cookie"] as string).split(";", 1)[0],
        csrf: result.json().csrf as string,
      };
    })();
    const auth = await session;
    if (typeof options !== "object" || options === null)
      throw new Error("Test injection requires options");
    const authenticated = {
      ...options,
      headers: {
        cookie: auth.cookie,
        "x-cie-csrf": auth.csrf,
        ...options.headers,
      },
    };
    // Legacy synthetic ask suites exercise the real preview/approve routes.
    if (options.url === "/api/v1/ai/ask" && options.method === "POST") {
      const preview = await inject({
        ...authenticated,
        url: "/api/v1/ai/preview",
      } as never);
      if (preview.statusCode !== 200) return preview;
      const body = options.payload as Record<string, unknown>;
      return inject({
        ...authenticated,
        url: "/api/v1/ai/approve",
        payload: {
          id: preview.json().id,
          repositoryId: body.repositoryId,
          revision: body.revision,
          manifest: body.manifest,
        },
      } as never);
    }
    return inject(authenticated as never);
  }) as typeof app.inject;
  return app;
}
