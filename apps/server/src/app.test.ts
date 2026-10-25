import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp();
});
afterEach(() => app.close());

describe("local API", () => {
  it("returns only the stable, nonsensitive health contract", async () => {
    const response = await app.inject("/api/v1/health");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      mode: "local",
      version: "0.1.0",
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not expose a filesystem API", async () => {
    expect((await app.inject("/api/v1/files")).statusCode).toBe(404);
  });
});
