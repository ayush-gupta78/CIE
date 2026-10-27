import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) =>
      url === "/api/v1/health"
        ? {
            ok: true,
            json: async () => ({
              status: "ok",
              mode: "local",
              version: "0.1.0",
            }),
          }
        : { ok: true, json: async () => ({ selected: false }) },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders an honest archive landing with a real navigation path and deferred features", async () => {
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "No repository selected" }),
    ).toBeTruthy(),
  );
  const graph = screen.getByRole("button", {
    name: "3D atlas",
  }) as HTMLButtonElement;
  expect(graph.disabled).toBe(false);
  for (const label of [
    "Findings M5",
    "Assistant M7",
    "Import analysis snapshot, not available yet",
  ]) {
    expect(
      (screen.getByRole("button", { name: label }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  }
  expect(
    (
      screen.getByRole("button", {
        name: /Continue Current Session/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0),
  );
  await userEvent.click(graph);
  // The atlas is lazy-loaded; CI's cold transform can exceed waitFor's 1s default.
  expect(
    await screen.findByRole(
      "heading",
      { name: "No repository selected." },
      { timeout: 5000 },
    ),
  ).toBeTruthy();
});

it("shows offline status and reconnects on retry", async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  render(<App />);
  await waitFor(() =>
    expect(screen.getAllByText("Disconnected").length).toBeGreaterThan(0),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Retry connection" }),
  );
  await waitFor(() =>
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0),
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("supports keyboard navigation through live links while skipping deferred destinations", async () => {
  const user = userEvent.setup();
  render(<App />);
  const workspace = screen.getByRole("button", { name: "Archive" });
  await user.tab();
  expect(workspace).toBe(document.activeElement);
  await user.tab();
  expect(screen.getByRole("button", { name: "Repository" })).toBe(
    document.activeElement,
  );
  await user.tab();
  expect(screen.getByRole("button", { name: "3D atlas" })).toBe(
    document.activeElement,
  );
  await user.tab();
  expect(screen.getByRole("button", { name: "Settings" })).toBe(
    document.activeElement,
  );
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Settings." })).toBeTruthy();
  await user.click(workspace);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "No repository selected" }),
    ).toBeTruthy(),
  );
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
});

it("rechecks the in-memory repository after a disconnected to checking to connected recovery", async () => {
  let online = true;
  let selected = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/health") {
        if (!online) throw new Error("offline");
        return {
          ok: true,
          json: async () => ({ status: "ok", mode: "local", version: "0.1.0" }),
        };
      }
      return {
        ok: true,
        json: async () =>
          selected
            ? {
                selected: true,
                repositoryId: "r1",
                revision: 1,
                rootName: "fixture",
              }
            : { selected: false },
      };
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "fixture" })).toBeTruthy(),
  );
  online = false;
  await user.click(screen.getByRole("button", { name: "Retry connection" }));
  await waitFor(() =>
    expect(screen.getAllByText("Disconnected").length).toBeGreaterThan(0),
  );
  online = true;
  selected = false;
  await user.click(screen.getByRole("button", { name: "Retry connection" }));
  await waitFor(() =>
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "No repository selected" }),
    ).toBeTruthy(),
  );
  expect(
    (
      screen.getByRole("button", {
        name: /Continue Current Session/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
