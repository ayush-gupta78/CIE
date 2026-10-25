import { useCallback, useEffect, useRef, useState } from "react";

export type Connection = "checking" | "connected" | "disconnected";

export function useLocalHealth() {
  const [connection, setConnection] = useState<Connection>("checking");
  const [version, setVersion] = useState("0.1.0");
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  const check = useCallback(() => {
    if (!mounted.current) return;
    controller.current?.abort();
    if (timer.current !== null) window.clearTimeout(timer.current);
    const current = ++generation.current;
    const next = new AbortController();
    controller.current = next;
    setConnection("checking");
    const timeout = window.setTimeout(() => next.abort(), 5000);
    timer.current = timeout;

    void (async () => {
      try {
        const response = await fetch("/api/v1/health", {
          cache: "no-store",
          signal: next.signal,
        });
        if (!response.ok) throw new Error("Health request failed");
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("status" in data) ||
          data.status !== "ok" ||
          !("mode" in data) ||
          data.mode !== "local" ||
          !("version" in data) ||
          typeof data.version !== "string"
        )
          throw new Error("Invalid health response");
        if (mounted.current && current === generation.current) {
          setVersion(data.version);
          setConnection("connected");
        }
      } catch {
        if (mounted.current && current === generation.current)
          setConnection("disconnected");
      } finally {
        window.clearTimeout(timeout);
        if (controller.current === next) {
          controller.current = null;
          timer.current = null;
        }
      }
    })();
  }, []);

  useEffect(() => {
    mounted.current = true;
    check();
    const interval = window.setInterval(check, 30_000);
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
      if (timer.current !== null) window.clearTimeout(timer.current);
      window.clearInterval(interval);
    };
  }, [check]);

  return { connection, version, check };
}
