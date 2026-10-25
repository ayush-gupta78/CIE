import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "./app.js";

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp();
});
afterEach(() => app.close());

it("accepts only exact loopback hosts and approved browser origins", async () => {
  for (const host of ["127.0.0.1:3001", "127.0.0.1:5173"]) {
    const response = await app.inject({
      url: "/api/v1/health",
      headers: { host, origin: "http://127.0.0.1:5173" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      mode: "local",
      version: "0.1.0",
    });
  }
  for (const host of [
    "evil.example:3001",
    "127.0.0.1.evil.example:3001",
    "localhost:3001",
    "127.0.0.1:9999",
  ]) {
    const response = await app.inject({
      url: "/api/v1/health",
      headers: { host },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("UNAPPROVED_HOST");
  }
  for (const origin of [
    "null",
    "https://evil.example",
    "http://127.0.0.1:5173.evil.example",
    "http://127.0.0.1:9999",
  ]) {
    const response = await app.inject({
      url: "/api/v1/health",
      headers: { host: "127.0.0.1:3001", origin },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("UNAPPROVED_ORIGIN");
  }
});

it("blocks simple-form mutations before routes or filesystem reads", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/repository/select",
    headers: { host: "127.0.0.1:3001", "content-type": "text/plain" },
    payload: "path=/home",
  });
  expect(response.statusCode).toBe(415);
  expect(response.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
});
