import { useEffect, useState } from "react";
import {
  getAiConfig,
  putAiConfig,
  testAiConfig,
  getNativeProviders,
  discoverAiModels,
  type NativeProvider,
  type AiConfig,
} from "./aiApi";
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
  const [preset, setPreset] =
    useState<NonNullable<AiConfig["preset"]>>("openai");
  const [nativeProviders, setNativeProviders] = useState<NativeProvider[]>([]);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [consent, setConsent] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tested, setTested] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [discoveryValid, setDiscoveryValid] = useState(false);
  const [discoveryTruncated, setDiscoveryTruncated] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    setTested(false);
    if (connection !== "connected") return;
    const controller = new AbortController();
    void getNativeProviders(controller.signal)
      .then((providers) => {
        if (!controller.signal.aborted) setNativeProviders(providers);
      })
      .catch(() => {});
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
          value.preset === "sambanova" ||
            value.preset === "novita" ||
            value.preset === "cohere" ||
            value.preset === "huggingface" ||
            value.preset === "xai" ||
            value.preset === "gemini" ||
            value.preset === "anthropic" ||
            value.preset === "fireworks" ||
            value.preset === "openrouter" ||
            value.preset === "nvidia" ||
            value.preset === "groq" ||
            value.preset === "deepseek" ||
            value.preset === "mistral" ||
            value.preset === "cerebras" ||
            value.preset === "together"
            ? value.preset
            : value.local
              ? "local"
              : value.endpointUrl === openAi.endpointUrl &&
                  value.providerName === openAi.providerName
                ? "openai"
                : "custom",
        );
        setManualModel(
          (value.preset === "sambanova" ||
            value.preset === "novita" ||
            value.preset === "cohere" ||
            value.preset === "huggingface" ||
            value.preset === "xai" ||
            value.preset === "fireworks" ||
            value.preset === "openrouter" ||
            value.preset === "nvidia" ||
            value.preset === "groq" ||
            value.preset === "deepseek" ||
            value.preset === "mistral" ||
            value.preset === "cerebras" ||
            value.preset === "together") &&
            value.model !== "select-a-model",
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
  useEffect(() => {
    let controller: AbortController | undefined;
    const invalidate = () => {
      setTested(false);
      setMessage("");
      setDiscoveryValid(false);
      setManualFallback(false);
      controller?.abort();
      if (connection === "connected" && config) {
        controller = new AbortController();
        const signal = controller.signal;
        setRefreshing(true);
        void getAiConfig(signal)
          .then((value) => {
            if (signal.aborted) return;
            if (JSON.stringify(value) !== JSON.stringify(config)) {
              setConfig(null);
              setMessage(
                "Settings changed in another tab. Reload before saving; unsaved edits are still shown.",
              );
            }
            setRefreshing(false);
          })
          .catch(() => {
            if (signal.aborted) return;
            setConfig(null);
            setRefreshing(false);
            setMessage("Settings unavailable. Retry the local API connection.");
          });
      }
    };
    window.addEventListener("focus", invalidate);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", invalidate);
    };
  }, [connection, config]);
  async function save() {
    setTested(false);
    setDiscoveryValid(false);
    setBusy(true);
    setMessage("");
    try {
      const result = await putAiConfig({
        enabled,
        protocol:
          preset === "gemini" || preset === "anthropic" || preset === "cohere"
            ? preset
            : "openai-compatible",
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
    setTested(false);
    setBusy(true);
    setMessage("");
    try {
      await testAiConfig();
      setTested(true);
      setMessage("Provider connection succeeded.");
    } catch (issue) {
      setMessage(
        issue instanceof Error ? issue.message : "Provider test failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    if (!config) return;
    setTested(false);
    setDiscoveryValid(false);
    setBusy(true);
    setMessage("");
    const payload = {
      enabled: true,
      consent: true,
      protocol:
        preset === "gemini" || preset === "anthropic" || preset === "cohere"
          ? preset
          : ("openai-compatible" as const),
      preset,
      ...draft,
    };
    try {
      // Destination changes revoke credentials and consent on the server.
      if (
        draft.endpointUrl !== config.endpointUrl ||
        draft.authMode !== config.authMode ||
        payload.protocol !== config.protocol ||
        preset !==
          (config.preset ??
            (config.local
              ? "local"
              : config.endpointUrl === openAi.endpointUrl
                ? "openai"
                : "custom"))
      ) {
        const staged = await putAiConfig({
          ...payload,
          enabled: false,
          consent: false,
        });
        setConfig(staged);
      }
      const result = await putAiConfig({
        ...payload,
        ...(key ? { apiKey: key } : {}),
      });
      setConfig(result);
      setEnabled(result.enabled);
      setConsent(result.consent);
      setKey("");
      setClearKey(false);
      if (
        !result.enabled ||
        !result.consent ||
        (result.authMode === "bearer" && !result.hasKey)
      ) {
        setMessage(
          "Settings saved, but consent or credentials are missing. Review and connect again.",
        );
        return;
      }
      const flexible =
        preset === "openai" || preset === "custom" || preset === "local";
      const unsupportedPath =
        (preset === "custom" || preset === "local") &&
        new URL(draft.endpointUrl).pathname !== "/v1/chat/completions";
      if (unsupportedPath || (flexible && manualFallback)) {
        if (!manualModel)
          throw new Error(
            "Choose a model manually in Advanced settings and reconnect. Connection not verified.",
          );
        setDiscoveryValid(true);
      } else if (
        preset === "custom" ||
        preset === "local" ||
        preset === "openai" ||
        preset === "sambanova" ||
        preset === "novita" ||
        preset === "cohere" ||
        preset === "huggingface" ||
        preset === "xai" ||
        preset === "fireworks" ||
        preset === "gemini" ||
        preset === "anthropic" ||
        preset === "openrouter" ||
        preset === "nvidia" ||
        preset === "groq" ||
        preset === "deepseek" ||
        preset === "mistral" ||
        preset === "cerebras" ||
        preset === "together"
      ) {
        let catalog: Awaited<ReturnType<typeof discoverAiModels>>;
        try {
          catalog = await discoverAiModels();
        } catch (issue) {
          if (!flexible) throw issue;
          setManualFallback(true);
          setDiscovered([]);
          setDiscoveryTruncated(false);
          throw new Error(
            "Model discovery unavailable. Choose a model manually in Advanced settings and reconnect; pricing and compatibility are unknown.",
          );
        }
        const { models, truncated } = catalog;
        setDiscovered(models);
        setDiscoveryTruncated(truncated);
        const preferred =
          preset === "openai"
            ? ["gpt-4o-mini"]
            : preset === "gemini"
              ? ["gemini-2.5-flash"]
              : preset === "anthropic"
                ? ["claude-haiku-4-5-20251001"]
                : ((
                    {
                      fireworks: [
                        "accounts/fireworks/models/llama-v3p1-8b-instruct",
                      ],
                      openrouter: ["openai/gpt-4o-mini"],
                      nvidia: ["meta/llama-3.3-70b-instruct"],
                      groq: ["llama-3.3-70b-versatile"],
                      deepseek: ["deepseek-v4-flash"],
                      mistral: ["mistral-small-latest"],
                      cerebras: ["qwen-3.8-27b"],
                      together: ["Qwen/Qwen3.5-9B"],
                    } as Partial<Record<typeof preset, string[]>>
                  )[preset] ?? []);
        const model = manualModel
          ? models.find((candidate) => candidate === draft.model.trim())
          : preferred.find((candidate) => models.includes(candidate));
        if (!model)
          throw new Error(
            "No supported model was found. Choose a discovered model manually in Advanced settings and reconnect. Connection not verified.",
          );
        if (model !== result.model) {
          const updated = await putAiConfig({ ...payload, model });
          if (
            !updated.enabled ||
            !updated.consent ||
            (updated.authMode === "bearer" && !updated.hasKey) ||
            updated.model !== model
          )
            throw new Error("Model settings could not be verified.");
          setConfig(updated);
          setDraft({ ...draft, model });
        }
        setDiscoveryValid(true);
      }
      await testAiConfig();
      setTested(true);
      setMessage("Provider connection succeeded.");
    } catch (issue) {
      setMessage(
        issue instanceof Error ? issue.message : "Provider connection failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const endpointChanged =
    draft.endpointUrl !== config?.endpointUrl ||
    draft.local !== config?.local ||
    draft.authMode !== config?.authMode ||
    (config?.preset !== undefined && preset !== config.preset);
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
    consent &&
    !key &&
    !clearKey &&
    draft.providerName === config.providerName &&
    draft.model === config.model &&
    draft.authMode === config.authMode &&
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
          onChange={() => {
            setMessage("");
            setTested(false);
            setDiscoveryValid(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset
            disabled={busy || refreshing}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <p>
              Connection test sends a short test message, not repository
              content.
            </p>
            <label>
              Provider preset
              <select
                value={preset}
                onChange={(event) => {
                  const choice = event.target.value as typeof preset;
                  setPreset(choice);
                  setManualModel(false);
                  setManualFallback(false);
                  setDiscovered([]);
                  setDiscoveryTruncated(false);
                  setDiscoveryValid(false);
                  setKey("");
                  setDraft(
                    nativeProviders.some(
                      (provider) => provider.preset === choice,
                    )
                      ? (() => {
                          const provider = nativeProviders.find(
                            (item) => item.preset === choice,
                          )!;
                          return {
                            providerName: provider.providerName,
                            endpointUrl: provider.endpointUrl,
                            authMode: provider.authMode,
                            local: provider.local,
                            model:
                              choice === "gemini"
                                ? "gemini-2.5-flash"
                                : choice === "anthropic"
                                  ? "claude-haiku-4-5-20251001"
                                  : provider.model || "select-a-model",
                          };
                        })()
                      : choice === "openai"
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
                {nativeProviders.map((provider) => (
                  <option key={provider.preset} value={provider.preset}>
                    {provider.providerName}
                  </option>
                ))}
                <option value="custom">Custom endpoint</option>
                <option value="local">Local endpoint</option>
              </select>
            </label>
            <details
              className="ai-advanced"
              open={preset === "custom" || preset === "local"}
            >
              <summary>Advanced settings</summary>
              <label>
                Provider name{" "}
                <input
                  required
                  maxLength={80}
                  value={draft.providerName}
                  readOnly={preset !== "custom" && preset !== "local"}
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
                  readOnly={preset !== "custom" && preset !== "local"}
                  onChange={(event) => {
                    setDraft({ ...draft, endpointUrl: event.target.value });
                    setManualModel(false);
                    setManualFallback(false);
                    setDiscovered([]);
                    setDiscoveryTruncated(false);
                    setConsent(false);
                  }}
                />
              </label>
              <label>
                Model{" "}
                <input
                  required
                  value={draft.model}
                  onChange={(event) => {
                    setManualModel(true);
                    setDiscoveryValid(false);
                    setDraft({ ...draft, model: event.target.value });
                  }}
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
            </details>
            <p>
              {localEndpoint ? "Local endpoint" : "External endpoint"}:{" "}
              {hostname}. The endpoint receives questions and bounded source
              context when you ask.
            </p>
            <p>
              Pricing is unknown. Provider tests and questions may incur
              charges. Check current model pricing before connecting, especially
              for manual overrides.
            </p>
            {discovered.length > 0 && (
              <p>Discovered models: {discovered.join(", ")}</p>
            )}
            {discoveryTruncated && (
              <p>Model discovery was truncated; this list may be incomplete.</p>
            )}
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
                  config?.hasKey
                    ? "Saved key (leave blank to keep)"
                    : "Enter key"
                }
              />
            </label>
            <details className="ai-advanced">
              <summary>Manage saved settings</summary>
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
            </details>
            <label className="ai-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{" "}
              I consent to sending relevant repository context and my questions
              to {hostname} ({localEndpoint ? "local" : "external"} endpoint).
            </label>
            <details className="ai-advanced">
              <summary>Save or disable without connecting</summary>
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
              </div>
            </details>
            <div className="ai-settings-actions">
              <button
                type="button"
                onClick={(event) => {
                  if (event.currentTarget.form?.reportValidity())
                    void connect();
                }}
                disabled={
                  connection !== "connected" ||
                  busy ||
                  !config ||
                  !consent ||
                  (draft.local && !loopback) ||
                  !draft.providerName.trim() ||
                  !draft.model.trim() ||
                  !draft.endpointUrl ||
                  (draft.authMode === "bearer" &&
                    !key &&
                    (!config.hasKey || endpointChanged || clearKey))
                }
              >
                Connect assistant
              </button>
              <button
                type="button"
                disabled={
                  connection !== "connected" ||
                  busy ||
                  !ready ||
                  ((preset === "custom" ||
                    preset === "local" ||
                    preset === "openai" ||
                    preset === "sambanova" ||
                    preset === "novita" ||
                    preset === "cohere" ||
                    preset === "huggingface" ||
                    preset === "fireworks" ||
                    preset === "xai" ||
                    preset === "gemini" ||
                    preset === "anthropic" ||
                    preset === "openrouter" ||
                    preset === "nvidia" ||
                    preset === "groq" ||
                    preset === "deepseek" ||
                    preset === "mistral" ||
                    preset === "cerebras" ||
                    preset === "together") &&
                    !discoveryValid)
                }
                onClick={() => void test()}
              >
                Test provider connection
              </button>
            </div>
          </fieldset>
        </form>
        {tested && connection === "connected" && <p>Connection: verified</p>}
        {message && <p role="status">{message}</p>}
      </section>
    </section>
  );
}
