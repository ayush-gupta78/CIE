import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { setCsrf } from "./repositoryApi";

type State = "checking" | "pair" | "ready" | "offline";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    const revoked = () => {
      updateAuthCsrf("");
      setState("pair");
    };
    window.addEventListener("cie-auth-required", revoked);
    fetch("/api/v1/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (current) setState("pair");
          return;
        }
        if (!response.ok) throw new Error("Local API offline");
        const body = (await response.json()) as { csrf: string };
        if (current) {
          updateAuthCsrf(body.csrf);
          setState("ready");
        }
      })
      .catch(() => {
        if (current) setState("offline");
      });
    return () => {
      current = false;
      window.removeEventListener("cie-auth-required", revoked);
    };
  }, []);
  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/v1/auth/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    }).catch(() => null);
    setSecret("");
    if (!response?.ok) {
      setMessage(
        response?.status === 429
          ? "Too many attempts. Wait a minute."
          : "Pairing failed. Check the launching terminal.",
      );
      return;
    }
    const body = (await response.json()) as { csrf: string };
    updateAuthCsrf(body.csrf);
    setState("ready");
  }
  if (state === "checking")
    return (
      <main>
        <p>Checking local authorization…</p>
      </main>
    );
  if (state === "offline")
    return (
      <main>
        <p>Local API is offline. Start CIE and reload this page.</p>
      </main>
    );
  if (state === "pair")
    return (
      <main className="settings-page">
        <h1>Authorize this browser</h1>
        <p>
          Enter the pairing secret shown in the terminal that launched CIE. It
          is never shown by the web server.
        </p>
        <form
          onSubmit={(event) => {
            void pair(event);
          }}
        >
          <label htmlFor="pairing-secret">Pairing secret</label>
          <input
            id="pairing-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            required
          />
          <button type="submit">Authorize</button>
        </form>
        <p role="status">{message}</p>
      </main>
    );
  return (
    <>
      {children}
      <button
        type="button"
        onClick={() => {
          void fetch("/api/v1/auth/logout", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CIE-CSRF": csrfValue(),
            },
            body: "{}",
          }).finally(() => {
            updateAuthCsrf("");
            setState("pair");
          });
        }}
      >
        Log out
      </button>
    </>
  );
}
let activeCsrf = "";
function csrfValue() {
  return activeCsrf;
}
export function updateAuthCsrf(value: string) {
  activeCsrf = value;
  setCsrf(value);
}
