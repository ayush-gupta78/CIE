import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./testApp.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp();
});
afterEach(() => app.close());

describe("local API", () => {
  it("serves built web assets on the API origin without bypassing the request gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "cie-m9-web-"));
    const outside = await mkdtemp(join(tmpdir(), "cie-m9-outside-"));
    try {
      await writeFile(join(root, "index.html"), "<h1>CIE production</h1>");
      await writeFile(join(root, "app.js"), "export const ready = true;");
      await writeFile(join(outside, "outside.js"), "not an asset");
      await symlink(join(outside, "outside.js"), join(root, "outside.js"));
      const built = createApp(undefined, root);
      try {
        const headers = { host: "127.0.0.1:3001" };
        expect((await built.inject({ url: "/", headers })).body).toContain(
          "CIE production",
        );
        for (const url of ["/", "/app.js", "/api/v1/health"]) {
          const response = await built.inject({ url, headers });
          expect(response.headers["content-security-policy"]).toContain(
            "script-src 'self'",
          );
          expect(response.headers["content-security-policy"]).toContain(
            "frame-ancestors 'none'",
          );
          expect(response.headers["content-security-policy"]).not.toContain(
            "unsafe-eval",
          );
          expect(response.headers["x-frame-options"]).toBe("DENY");
          expect(response.headers["x-content-type-options"]).toBe("nosniff");
          expect(response.headers["referrer-policy"]).toBe("no-referrer");
          expect(response.headers["permissions-policy"]).toContain("camera=()");
        }
        expect(
          (await built.inject({ url: "/app.js", headers })).headers[
            "content-type"
          ],
        ).toContain("javascript");
        expect(
          (await built.inject({ url: "/api/v1/unknown", headers })).statusCode,
        ).toBe(404);
        expect(
          (await built.inject({ url: "/missing.js", headers })).statusCode,
        ).toBe(404);
        expect(
          (await built.inject({ url: "/outside.js", headers })).statusCode,
        ).toBe(404);
        expect(
          (await built.inject({ url: "/%2e%2e%2foutside.js", headers }))
            .statusCode,
        ).toBe(404);
        expect(
          (await built.inject({ url: "/", headers: { host: "evil.test" } }))
            .statusCode,
        ).toBe(403);
        expect(
          (
            await built.inject({
              url: "/",
              headers: { ...headers, origin: "http://evil.test" },
            })
          ).statusCode,
        ).toBe(403);
      } finally {
        await built.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("returns only the stable, nonsensitive health contract", async () => {
    const response = await app.inject({
      url: "/api/v1/health",
      headers: { host: "127.0.0.1:3001" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      mode: "local",
      version: "0.1.0",
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not expose a filesystem API", async () => {
    expect(
      (
        await app.inject({
          url: "/api/v1/files",
          headers: { host: "127.0.0.1:3001" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
