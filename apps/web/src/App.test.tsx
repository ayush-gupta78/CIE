import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok", mode: "local", version: "0.1.0" }),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders an honest empty workspace and disabled future features", async () => {
  render(<App />);
  expect(screen.getByText("No repository loaded.")).toBeTruthy();
  expect(screen.getByText("No file selected")).toBeTruthy();
  for (const label of [
    "Repository, available in M1",
    "Graph, available in M3",
    "Insights, available in M5",
    "AI, available in M7",
  ]) {
    expect(
      (screen.getByRole("button", { name: label }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  }
  expect(
    (screen.getByRole("button", { name: /3D M3/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await waitFor(() =>
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0),
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
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("supports keyboard navigation to Settings and back without enabling future features", async () => {
  const user = userEvent.setup();
  render(<App />);
  const workspace = screen.getByRole("button", { name: "Workspace" });
  await user.tab(); // top-bar Settings
  await user.tab();
  expect(workspace).toBe(document.activeElement);
  await user.tab(); // disabled milestones are skipped
  expect(
    screen.getByRole("navigation").querySelector("[aria-current]"),
  ).not.toBeNull();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Settings." })).toBeTruthy();
  await user.click(workspace);
  expect(screen.getByText("No repository loaded.")).toBeTruthy();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
});
