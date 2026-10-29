import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings";

const initial = {
  enabled: false,
  consent: true,
  providerName: "OpenAI",
  protocol: "openai-compatible",
  endpointUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  authMode: "bearer",
  local: false,
  hasKey: true,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("requires renewed endpoint consent and saves a custom endpoint with a cleared key", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () =>
      init?.method === "PUT"
        ? { ...initial, ...JSON.parse(init.body as string), hasKey: false }
        : initial,
  }));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("combobox", { name: /Provider preset/ });
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
        .checked,
    ).toBe(true),
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "custom",
  );
  await user.type(
    screen.getByRole("textbox", { name: /Provider name/ }),
    "Example",
  );
  await user.type(
    screen.getByRole("textbox", { name: /Endpoint URL/ }),
    "https://example.com/v1/chat/completions",
  );
  await user.type(
    screen.getByRole("textbox", { name: /Model/ }),
    "other-model",
  );
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: /consent/i })
      .checked,
  ).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: /Clear saved key/ }));
  await user.click(screen.getByRole("checkbox", { name: /consent/i }));
  await user.click(
    screen.getByRole("button", { name: "Save assistant settings" }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toMatchObject({
    providerName: "Example",
    endpointUrl: "https://example.com/v1/chat/completions",
    model: "other-model",
    local: false,
    authMode: "bearer",
    consent: true,
    apiKey: null,
  });
  expect(screen.getAllByText(/example.com/).length).toBeGreaterThan(0);
});
it("allows a local endpoint without bearer credentials and discloses locality", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => initial })),
  );
  const user = userEvent.setup();
  render(
    <Settings
      version="1"
      statusText="Connected"
      connection="connected"
      check={() => {}}
    />,
  );
  await screen.findByRole("combobox", { name: /Provider preset/ });
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Provider preset/ }),
    "local",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Authentication/ }),
    "none",
  );
  expect(screen.getAllByText(/local endpoint/i).length).toBeGreaterThan(0);
  expect(
    screen.getByRole("button", { name: "Save assistant settings" }),
  ).toBeTruthy();
  await user.clear(screen.getByRole("textbox", { name: /Endpoint URL/ }));
  await user.type(
    screen.getByRole("textbox", { name: /Endpoint URL/ }),
    "https://remote.example/v1/chat/completions",
  );
  expect(screen.getByText(/External endpoint: remote.example/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "Save assistant settings",
    }).disabled,
  ).toBe(true);
});
