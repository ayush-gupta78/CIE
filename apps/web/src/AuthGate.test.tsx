import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AuthGate } from "./AuthGate";
import { json, request } from "./repositoryApi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("distinguishes an offline API from a browser requiring pairing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  render(
    <AuthGate>
      <p>Privileged workspace</p>
    </AuthGate>,
  );
  expect(await screen.findByText(/Local API is offline/)).toBeTruthy();
  expect(screen.queryByLabelText("Pairing secret")).toBeNull();
});

it("requires terminal pairing before rendering privileged UI and sends CSRF on mutations", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/auth/session")
      return new Response("{}", { status: 401 });
    if (url === "/api/v1/auth/pair") {
      expect(JSON.parse(init?.body as string)).toEqual({
        secret: "synthetic pairing phrase",
      });
      return new Response(JSON.stringify({ csrf: "csrf-fixture" }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ selected: false }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <AuthGate>
      <p>Privileged workspace</p>
    </AuthGate>,
  );
  expect(screen.queryByText("Privileged workspace")).toBeNull();
  const input = await screen.findByLabelText("Pairing secret");
  fireEvent.change(input, { target: { value: "synthetic pairing phrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
  await screen.findByText("Privileged workspace");
  await request("/api/v1/repository/rescan", json("POST", {}));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/repository/rescan",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-CIE-CSRF": "csrf-fixture" }),
      }),
    ),
  );
  fetcher.mockImplementationOnce(
    async () =>
      new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED" } }), {
        status: 401,
      }),
  );
  await expect(request("/api/v1/repository")).rejects.toThrow();
  expect(await screen.findByLabelText("Pairing secret")).toBeTruthy();
});
