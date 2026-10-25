import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

const selected = {
  selected: true,
  repositoryId: "r1",
  revision: 1,
  rootName: "sample",
};
const entry = (name: string, kind: "file" | "directory", path = name) => ({
  name,
  kind,
  path,
  ...(kind === "file"
    ? { sizeBytes: 5, modifiedAt: "2026-10-25T00:00:00.000Z" }
    : {}),
});
const reply = (value: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
const page = (
  dir: string,
  entries: unknown[],
  nextCursor: string | null = null,
  revision = 1,
) => ({ repositoryId: "r1", revision, dir, entries, nextCursor });
const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === "/api/v1/health")
    return reply({ status: "ok", mode: "local", version: "0.1.0" });
  if (url === "/api/v1/repository" && !init?.method)
    return reply({ selected: false });
  if (url.endsWith("/select")) return reply(selected);
  if (url.includes("/tree")) {
    const params = new URL(url, "http://local").searchParams;
    if (params.get("dir") === "src")
      return reply(page("src", [entry("café.ts", "file", "src/café.ts")]));
    if (params.has("cursor"))
      return reply(page(".", [entry("README.md", "file")], null));
    return reply(page(".", [entry("src", "directory")], "page2"));
  }
  if (url.endsWith("/rescan")) return reply({ ...selected, revision: 2 });
  if (init?.method === "DELETE") return reply({ selected: false });
  throw new Error(`unexpected request ${url}`);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetcher.mockClear();
});

it("discards a late tree response after switching repositories", async () => {
  let resolveOld!: (value: ReturnType<typeof reply>) => void;
  const oldTree = new Promise<ReturnType<typeof reply>>((resolve) => {
    resolveOld = resolve;
  });
  let chosen = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/health")
        return reply({ status: "ok", mode: "local", version: "0.1.0" });
      if (url === "/api/v1/repository" && !init?.method)
        return reply({ selected: false });
      if (url.endsWith("/select"))
        return reply(
          ++chosen === 1
            ? selected
            : {
                ...selected,
                repositoryId: "r2",
                rootName: "second",
                revision: 2,
              },
        );
      if (url.includes("/tree"))
        return url.includes("repositoryId=r1")
          ? oldTree
          : reply({
              repositoryId: "r2",
              revision: 2,
              dir: ".",
              entries: [entry("new.ts", "file")],
              nextCursor: null,
            });
      throw new Error(url);
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Repository" }));
  await user.type(
    screen.getByRole("textbox", { name: "Local directory path" }),
    "/first",
  );
  await user.click(screen.getByRole("button", { name: "Open repository" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Change repository" }),
    ).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Change repository" }));
  await user.type(
    screen.getByRole("textbox", { name: "Local directory path" }),
    "/second",
  );
  await user.click(screen.getByRole("button", { name: "Open repository" }));
  await waitFor(() => expect(screen.getByText("new.ts")).toBeTruthy());
  resolveOld(reply(page(".", [entry("old-secret.ts", "file")])));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText("old-secret.ts")).toBeNull();
});

it("refreshes visible files and keeps the directory browser honest", async () => {
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Repository" }));
  await user.type(
    screen.getByRole("textbox", { name: "Local directory path" }),
    "/example/sample",
  );
  await user.click(screen.getByRole("button", { name: "Open repository" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy(),
  );
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("revision=2")),
    ).toBe(true),
  );
  expect(screen.queryByText("Fake dependency edge")).toBeNull();
});

it("selects, expands, paginates, inspects metadata and deselects", async () => {
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Repository" }));
  await user.type(
    screen.getByRole("textbox", { name: "Local directory path" }),
    "/example/sample",
  );
  await user.click(screen.getByRole("button", { name: "Open repository" }));
  await waitFor(() =>
    expect(screen.getAllByText("sample").length).toBeGreaterThan(0),
  );
  await user.click(screen.getByRole("button", { name: /src.*Expand/ }));
  await waitFor(() => expect(screen.getByText("café.ts")).toBeTruthy());
  await user.click(screen.getByRole("button", { name: /café.ts/ }));
  expect(
    within(
      screen.getByRole("complementary", { name: "File details" }),
    ).getByText("src/café.ts"),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(screen.getByText("README.md")).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "Close repository" }));
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Local directory path" }),
    ).toBeTruthy(),
  );
  expect(
    (screen.getByRole("button", { name: /Graph.*M3/ }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
