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

it("renders an honest empty workspace with Graph navigation and disabled later features", async () => {
  render(<App />);
  await waitFor(() =>
    expect(screen.getByText("No repository loaded.")).toBeTruthy(),
  );
  expect(screen.getByText("No file selected")).toBeTruthy();
  const graph = screen.getByRole("button", {
    name: "Graph",
  }) as HTMLButtonElement;
  expect(graph.disabled).toBe(false);
  for (const label of ["Insights, available in M5", "AI, available in M7"]) {
    expect(
      (screen.getByRole("button", { name: label }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  }
  expect(
    (screen.getByRole("button", { name: "3D" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0),
  );
  await userEvent.click(graph);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "No repository selected." }),
    ).toBeTruthy(),
  );
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

it("supports keyboard navigation to Settings and back without enabling future features", async () => {
  const user = userEvent.setup();
  render(<App />);
  const workspace = screen.getByRole("button", { name: "Workspace" });
  await user.tab(); // top-bar Settings
  await user.tab();
  expect(workspace).toBe(document.activeElement);
  await user.tab();
  expect(screen.getByRole("button", { name: "Repository" })).toBe(
    document.activeElement,
  );
  await user.tab(); // Graph is now available
  expect(screen.getByRole("button", { name: "Graph" })).toBe(
    document.activeElement,
  );
  await user.tab(); // disabled milestones are skipped
  expect(
    screen.getByRole("navigation").querySelector('[aria-current="page"]'),
  ).not.toBeNull();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Settings." })).toBeTruthy();
  await user.click(workspace);
  await waitFor(() =>
    expect(screen.getByText("No repository loaded.")).toBeTruthy(),
  );
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
});
