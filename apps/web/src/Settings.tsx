import { useEffect, useState } from "react";
import { getAiConfig, putAiConfig, testAiConfig, type AiConfig } from "./aiApi";
import type { Connection } from "./useLocalHealth";

export function Settings({
  version,
  statusText,
  connection,
  check,
}: {
  version: string;
  statusText: string;
  connection: Connection;
  check: () => void;
}) {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (connection !== "connected") return;
    const controller = new AbortController();
    void getAiConfig(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setConfig(value);
        setConsent(value.consent);
        setEnabled(value.enabled);
      })
      .catch((issue: unknown) => {
        if (!controller.signal.aborted)
          setMessage(
            issue instanceof Error ? issue.message : "Settings unavailable.",
          );
      });
    return () => controller.abort();
  }, [connection]);
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await putAiConfig({
        enabled,
        provider: "openai",
        model: "gpt-4o-mini",
        consent,
        ...(key ? { apiKey: key } : {}),
      });
      setConfig(result);
      setKey("");
      setMessage("Assistant settings saved locally.");
    } catch (issue) {
      setMessage(
        issue instanceof Error ? issue.message : "Settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage("");
    try {
      await testAiConfig();
      setMessage("Provider connection succeeded.");
    } catch (issue) {
      setMessage(
        issue instanceof Error ? issue.message : "Provider test failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <p className="kicker">Preferences</p>
      <h1 id="settings-title">Settings.</h1>
      <p className="intro-copy">
        Repository analysis stays local. Optional assistant questions send
        selected source context to an external provider only after explicit
        consent.
      </p>
      <dl className="settings-list">
        <div>
          <dt>Application version</dt>
          <dd>{version}</dd>
        </div>
        <div>
          <dt>Privacy</dt>
          <dd>
            Local by default. The optional assistant sends relevant repository
            context to OpenAI only after consent and an explicit question or
            provider test. No telemetry.
          </dd>
        </div>
        <div>
          <dt>Motion</dt>
          <dd>Follows your system’s reduced-motion setting.</dd>
        </div>
        <div>
          <dt>Local API</dt>
          <dd>
            {statusText}.{" "}
            <button
              type="button"
              className="inline-button"
              onClick={() => void check()}
              disabled={connection === "checking"}
            >
              Retry connection
            </button>
          </dd>
        </div>
      </dl>
      <section className="ai-settings" aria-label="Assistant settings">
        <h2>Optional assistant</h2>
        <p>
          Off by default. The API key is held by the local server, never
          returned to the browser. Questions may transmit selected source
          snippets and graph context to OpenAI; avoid enabling this for
          confidential code without authorization.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Provider <input value="OpenAI" readOnly />
          </label>
          <label>
            Model <input value="gpt-4o-mini" readOnly />
          </label>
          <label>
            API key{" "}
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              placeholder={
                config?.hasKey ? "Saved key (leave blank to keep)" : "Enter key"
              }
            />
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />{" "}
            I consent to sending relevant repository context and my questions to
            OpenAI.
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />{" "}
            Enable assistant requests
          </label>
          <div className="ai-settings-actions">
            <button
              type="submit"
              disabled={
                connection !== "connected" ||
                busy ||
                (enabled && (!consent || (!config?.hasKey && !key)))
              }
            >
              Save assistant settings
            </button>
            <button
              type="button"
              disabled={
                connection !== "connected" ||
                busy ||
                !config?.enabled ||
                !config?.consent ||
                !config?.hasKey
              }
              onClick={() => void test()}
            >
              Test provider connection
            </button>
          </div>
        </form>
        {message && <p role="status">{message}</p>}
      </section>
    </section>
  );
}
