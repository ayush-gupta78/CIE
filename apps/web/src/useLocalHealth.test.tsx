import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLocalHealth } from "./useLocalHealth";

const response = (version = "0.1.0") => ({
  ok: true,
  json: async () => ({ status: "ok", mode: "local", version }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps the latest success when an older request fails late", async () => {
  const first = deferred();
  const second = deferred();
  const fetchMock = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useLocalHealth());
  act(() => {
    result.current.check();
  });
  expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  await act(async () => {
    second.resolve(response("new"));
    await second.promise;
  });
  await act(async () => {
    first.reject(new Error("stale offline"));
    try {
      await first.promise;
    } catch {
      /* expected */
    }
  });
  expect(result.current).toMatchObject({
    connection: "connected",
    version: "new",
  });
});

it("keeps the latest failure when an older request succeeds late", async () => {
  const first = deferred();
  const second = deferred();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise),
  );
  const { result } = renderHook(() => useLocalHealth());
  act(() => {
    result.current.check();
  });
  await act(async () => {
    second.reject(new Error("offline"));
    try {
      await second.promise;
    } catch {
      /* expected */
    }
  });
  await act(async () => {
    first.resolve(response("stale"));
    await first.promise;
  });
  expect(result.current.connection).toBe("disconnected");
  expect(result.current.version).toBe("0.1.0");
});

it("times out, then recovers on retry and aborts on unmount", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      (_url, options: RequestInit) =>
        new Promise((resolve, reject) => {
          signals.push(options.signal!);
          options.signal!.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          if (signals.length === 2) resolve(response());
        }),
    ),
  );
  const { result, unmount } = renderHook(() => useLocalHealth());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5001);
  });
  expect(result.current.connection).toBe("disconnected");
  await act(async () => {
    result.current.check();
    await Promise.resolve();
  });
  expect(result.current.connection).toBe("connected");
  act(() => {
    result.current.check();
  });
  unmount();
  expect(signals.at(-1)?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
