import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const app = () => {
  const instance = createApp(undefined, undefined, "fixture-owner-secret");
  apps.push(instance);
  return instance;
};
const headers = { host: "127.0.0.1:3001", "content-type": "application/json" };

it("denies every privileged read and mutation to direct unauthenticated clients", async () => {
  const server = app();
  for (const route of [
    "/api/v1/repository",
    "/api/v1/repository/graph",
    "/api/v1/repository/tree",
    "/api/v1/repository/insights",
    "/api/v1/repository/impact",
    "/api/v1/repository/source",
    "/api/v1/ai/config",
    "/api/v1/ai/providers",
  ]) {
    expect(
      (await server.inject({ url: route, headers })).statusCode,
      route,
    ).toBe(401);
  }
  for (const route of [
    "/api/v1/repository/select",
    "/api/v1/repository/analyze",
    "/api/v1/ai/models",
    "/api/v1/ai/test",
    "/api/v1/ai/ask",
  ]) {
    expect(
      (
        await server.inject({
          method: "POST",
          url: route,
          headers,
          payload: {},
        })
      ).statusCode,
      route,
    ).toBe(401);
  }
  expect(
    (
      await server.inject({
        method: "PUT",
        url: "/api/v1/ai/config",
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await server.inject({
        method: "DELETE",
        url: "/api/v1/repository",
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await server.inject({ url: "/api/v1/health", headers })).statusCode,
  ).toBe(200);
});

it("does not bypass authorization through percent-encoded route segments", async () => {
  const server = app();
  for (const route of [
    "/%61pi/v1/repository",
    "/api/%76%31/repository",
    "/api/v1/%72epository",
  ]) {
    expect(
      (await server.inject({ url: route, headers })).statusCode,
      route,
    ).toBe(401);
  }
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/%61pi/v1/repository/select",
        headers,
        payload: { path: process.cwd() },
      })
    ).statusCode,
  ).toBe(401);
  const paired = await server.inject({
    method: "POST",
    url: "/api/v1/auth/pair",
    headers,
    payload: { secret: "fixture-owner-secret" },
  });
  const cookie = (paired.headers["set-cookie"] as string).split(";", 1)[0];
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/%76%31/repository/select",
        headers: { ...headers, cookie },
        payload: { path: process.cwd() },
      })
    ).statusCode,
  ).toBe(403);
});

it("pairs with owner secret, requires CSRF, revokes on logout and restart", async () => {
  const server = app();
  const wrong = await server.inject({
    method: "POST",
    url: "/api/v1/auth/pair",
    headers,
    payload: { secret: "wrong" },
  });
  expect(wrong.statusCode).toBe(401);
  expect(wrong.body).not.toContain("fixture-owner-secret");
  const paired = await server.inject({
    method: "POST",
    url: "/api/v1/auth/pair",
    headers,
    payload: { secret: "fixture-owner-secret" },
  });
  expect(paired.statusCode).toBe(200);
  const cookie = paired.headers["set-cookie"] as string;
  expect(cookie).toMatch(/HttpOnly; SameSite=Strict/);
  expect(cookie).not.toContain("Secure");
  expect(cookie).not.toContain("Domain=");
  const csrf = paired.json().csrf;
  expect(cookie).not.toContain("fixture-owner-secret");
  const authorized = { ...headers, cookie: cookie.split(";", 1)[0] };
  expect(
    (await server.inject({ url: "/api/v1/repository", headers: authorized }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/v1/repository/rescan",
        headers: authorized,
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/v1/repository/rescan",
        headers: {
          ...authorized,
          "x-cie-csrf": csrf,
          origin: "https://evil.test",
        },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { ...authorized, "x-cie-csrf": csrf },
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await server.inject({ url: "/api/v1/repository", headers: authorized }))
      .statusCode,
  ).toBe(401);
  expect(
    (await app().inject({ url: "/api/v1/repository", headers: authorized }))
      .statusCode,
  ).toBe(401);
});

it("bounds pairing guesses", async () => {
  const server = app();
  for (let i = 0; i < 5; i++)
    await server.inject({
      method: "POST",
      url: "/api/v1/auth/pair",
      headers,
      payload: { secret: "wrong" },
    });
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/api/v1/auth/pair",
        headers,
        payload: { secret: "fixture-owner-secret" },
      })
    ).statusCode,
  ).toBe(429);
});

it("rejects forged and expired cookies while allowing a fresh owner pairing", async () => {
  const server = app();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const pair = () =>
    server.inject({
      method: "POST",
      url: "/api/v1/auth/pair",
      headers,
      payload: { secret: "fixture-owner-secret" },
    });
  const first = await pair();
  const original = (first.headers["set-cookie"] as string).split(";", 1)[0];
  expect(
    (
      await server.inject({
        url: "/api/v1/repository",
        headers: { ...headers, cookie: "cie_session=forged" },
      })
    ).statusCode,
  ).toBe(401);
  vi.spyOn(Date, "now").mockReturnValue(now + 8 * 60 * 60_000 + 1);
  expect(
    (
      await server.inject({
        url: "/api/v1/repository",
        headers: { ...headers, cookie: original },
      })
    ).statusCode,
  ).toBe(401);
  const second = await pair();
  expect(
    (
      await server.inject({
        url: "/api/v1/repository",
        headers: {
          ...headers,
          cookie: (second.headers["set-cookie"] as string).split(";", 1)[0],
        },
      })
    ).statusCode,
  ).toBe(200);
});
