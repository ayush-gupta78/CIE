import { useEffect, useState } from "react";
import { getAiConfig, putAiConfig, testAiConfig, type AiConfig } from "./aiApi";
import type { Connection } from "./useLocalHealth";

const openAi = {
  providerName: "OpenAI",
  endpointUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  authMode: "bearer" as const,
  local: false,
};
const localDefault = {
  providerName: "Local model",
  endpointUrl: "http://127.0.0.1:11434/v1/chat/completions",
  model: "local-model",
  authMode: "none" as const,
  local: true,
};

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
  const [draft, setDraft] =
    useState<Omit<AiConfig, "enabled" | "consent" | "protocol" | "hasKey">>(
      openAi,
    );
  const [preset, setPreset] = useState<"openai" | "custom" | "local">("openai");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
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
        setDraft({
          providerName: value.providerName,
          endpointUrl: value.endpointUrl,
          model: value.model,
          authMode: value.authMode,
          local: value.local,
        });
        setPreset(
          value.local
            ? "local"
            : value.endpointUrl === openAi.endpointUrl &&
                value.model === openAi.model &&
                value.providerName === openAi.providerName
              ? "openai"
              : "custom",
        );
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
        protocol: "openai-compatible",
        preset,
        ...draft,
        consent,
        ...(clearKey ? { apiKey: null } : key ? { apiKey: key } : {}),
      });
      setConfig(result);
      setConsent(result.consent);
      setEnabled(result.enabled);
      setKey("");
      setClearKey(false);
      setMessage(
        result.consent === consent
          ? "Assistant settings saved locally."
          : "Endpoint changed; re-enter credentials if required, confirm consent for the saved destination, and save again.",
      );
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
  const endpointChanged =
    draft.endpointUrl !== config?.endpointUrl || draft.local !== config.local;
  let hostname = "invalid endpoint";
  try {
    hostname = new URL(draft.endpointUrl).hostname || hostname;
  } catch {
    /* Native URL validation on submit. */
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  const localEndpoint = draft.local && loopback;
  const ready =
    !!config &&
    !endpointChanged &&
    config.enabled &&
    config.consent &&
    (config.authMode === "none" || config.hasKey);
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <p className="kicker">Preferences</p>
      <h1 id="settings-title">Settings.</h1>
      <p className="intro-copy">
        Repository analysis stays local. Optional assistant questions send
        selected source context to your configured endpoint only after explicit
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
            Local by default. Assistant transmission requires consent for the
            configured endpoint and an explicit question or provider test. No
            telemetry.
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
          Off by default. Credentials stay in the local server and are never
          returned to the browser. Questions may transmit selected source
          snippets, graph context and question text to the endpoint below. Only
          use code you are authorized to send.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Provider preset
            <select
              value={preset}
              onChange={(event) => {
                const choice = event.target.value as typeof preset;
                setPreset(choice);
                setDraft(
                  choice === "openai"
                    ? openAi
                    : choice === "local"
                      ? localDefault
                      : {
                          providerName: "",
                          endpointUrl: "",
                          model: "",
                          authMode: "bearer",
                          local: false,
                        },
                );
                setConsent(false);
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="custom">Custom endpoint</option>
              <option value="local">Local endpoint</option>
            </select>
          </label>
          <label>
            Provider name{" "}
            <input
              required
              maxLength={80}
              value={draft.providerName}
              readOnly={preset === "openai"}
              onChange={(event) =>
                setDraft({ ...draft, providerName: event.target.value })
              }
            />
          </label>
          <label>
            Endpoint URL{" "}
            <input
              type="url"
              required
              value={draft.endpointUrl}
              readOnly={preset === "openai"}
              onChange={(event) => {
                setDraft({ ...draft, endpointUrl: event.target.value });
                setConsent(false);
              }}
            />
          </label>
          <label>
            Model{" "}
            <input
              required
              value={draft.model}
              readOnly={preset === "openai"}
              onChange={(event) =>
                setDraft({ ...draft, model: event.target.value })
              }
            />
          </label>
          {preset === "local" && (
            <label>
              Authentication{" "}
              <select
                value={draft.authMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    authMode: event.target.value as "bearer" | "none",
                  })
                }
              >
                <option value="none">None</option>
                <option value="bearer">Bearer key</option>
              </select>
            </label>
          )}
          <p>
            {localEndpoint ? "Local endpoint" : "External endpoint"}: {hostname}
            . The endpoint receives questions and bounded source context when
            you ask.
          </p>
          {draft.local && !loopback && (
            <p role="alert">Local mode requires a loopback endpoint.</p>
          )}
          <label>
            API key (replace saved key){" "}
            <input
              type="password"
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setClearKey(false);
              }}
              disabled={draft.authMode === "none"}
              autoComplete="off"
              placeholder={
                config?.hasKey ? "Saved key (leave blank to keep)" : "Enter key"
              }
            />
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={clearKey}
              disabled={!config?.hasKey}
              onChange={(event) => {
                setClearKey(event.target.checked);
                if (event.target.checked) setKey("");
              }}
            />{" "}
            Clear saved key
          </label>
          <label className="ai-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />{" "}
            I consent to sending relevant repository context and my questions to{" "}
            {hostname} ({localEndpoint ? "local" : "external"} endpoint).
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
                !config ||
                (draft.local && !loopback) ||
                (enabled &&
                  (!consent ||
                    (draft.authMode === "bearer" &&
                      (!config.hasKey || clearKey || endpointChanged) &&
                      !key)))
              }
            >
              Save assistant settings
            </button>
            <button
              type="button"
              disabled={connection !== "connected" || busy || !ready}
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
