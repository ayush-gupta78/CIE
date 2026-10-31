import type { ProviderSafeText } from "./repository.js";
import { isIP } from "node:net";
import { hostedPresets, manualPresets } from "./aiProviderRegistry.js";
import { post } from "./aiProviderTransport.js";
export { hostedPresets, manualPresets } from "./aiProviderRegistry.js";

export type ProviderConfig = {
  preset:
    | "openai"
    | "custom"
    | "local"
    | "anthropic"
    | "gemini"
    | "openrouter"
    | "nvidia"
    | "groq"
    | "deepseek"
    | "mistral"
    | "cerebras"
    | "together"
    | "xai"
    | "fireworks"
    | "cohere"
    | "huggingface"
    | "sambanova"
    | "novita";
  protocol: "openai-compatible" | "anthropic" | "gemini" | "cohere";
  endpoint: string;
  model: string;
  providerName: string;
  authMode: "bearer" | "none";
  key?: string;
};
export type ProviderCaller = (
  config: ProviderConfig,
  messages: {
    role: "system" | "user" | "assistant";
    content: ProviderSafeText;
  }[],
  signal: AbortSignal,
  purpose?: "test",
) => Promise<unknown>;
export class ProviderError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const unavailable = () => new Error("AI provider unavailable.");
const invalid = () => new Error("Invalid AI provider configuration.");
function checkStatus(status: number) {
  if (status === 401)
    throw new ProviderError(
      502,
      "AI_AUTH",
      "AI provider rejected credentials. Check the API key.",
    );
  if (status === 403)
    throw new ProviderError(
      502,
      "AI_FORBIDDEN",
      "AI provider denied access. Check provider permissions and model access.",
    );
  if (status === 404)
    throw new ProviderError(
      502,
      "AI_NOT_FOUND",
      "AI provider resource not found. Check the model and endpoint.",
    );
  if (status === 429)
    throw new ProviderError(
      429,
      "AI_RATE_LIMIT",
      "AI provider rate limit reached. Wait and try again.",
    );
  if (status < 200 || status >= 300) throw unavailable();
}
const hasControl = (text: string) =>
  [...text].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

/** Validate untrusted configuration before storing or using it. Never echo its values in errors. */
export function validateProviderConfig(value: unknown): ProviderConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (key) =>
        ![
          "preset",
          "protocol",
          "endpoint",
          "model",
          "providerName",
          "authMode",
          "key",
        ].includes(key),
    ) ||
    ![
      "openai",
      "custom",
      "local",
      "anthropic",
      "gemini",
      ...Object.keys(hostedPresets),
      ...Object.keys(manualPresets),
    ].includes(v.preset as string) ||
    v.protocol !==
      (v.preset === "anthropic" ||
      v.preset === "gemini" ||
      v.preset === "cohere"
        ? v.preset
        : "openai-compatible") ||
    (v.preset === "gemini" &&
      (typeof v.model !== "string" ||
        !/^[a-zA-Z0-9._-]{1,128}$/.test(v.model))) ||
    typeof v.endpoint !== "string" ||
    v.endpoint.length > 2048 ||
    hasControl(v.endpoint) ||
    typeof v.model !== "string" ||
    !v.model.trim() ||
    v.model.length > 128 ||
    hasControl(v.model) ||
    typeof v.providerName !== "string" ||
    !v.providerName.trim() ||
    v.providerName.length > 128 ||
    hasControl(v.providerName) ||
    !["bearer", "none"].includes(v.authMode as string) ||
    (v.authMode === "none" && (v.preset !== "local" || v.key !== undefined)) ||
    (v.authMode === "bearer" &&
      (typeof v.key !== "string" || !/^[\x21-\x7e]{1,256}$/.test(v.key)))
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    throw invalid();
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !url.hostname ||
    !url.pathname ||
    (v.preset === "local"
      ? url.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      : url.protocol !== "https:" ||
        isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 ||
        url.hostname === "localhost" ||
        url.hostname.endsWith(".localhost") ||
        url.hostname.endsWith(".local"))
  )
    throw invalid();
  const fixedEndpoints: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models",
    ...Object.fromEntries(
      Object.entries({ ...hostedPresets, ...manualPresets }).map(
        ([key, value]) => [key, value.endpoint],
      ),
    ),
  };
  if (
    typeof v.preset === "string" &&
    fixedEndpoints[v.preset] &&
    url.href !== fixedEndpoints[v.preset]
  )
    throw invalid();
  return {
    preset: v.preset as ProviderConfig["preset"],
    protocol: v.protocol as ProviderConfig["protocol"],
    endpoint: url.href,
    model: v.model as string,
    providerName: v.providerName as string,
    authMode: v.authMode as ProviderConfig["authMode"],
    ...(v.key === undefined ? {} : { key: v.key as string }),
  };
}

/** POST a chat completion; return parsed JSON message content. Caller owns the AbortSignal. */
export async function callProvider(
  rawConfig: ProviderConfig,
  messages: {
    role: "system" | "user" | "assistant";
    content: ProviderSafeText;
  }[],
  signal: AbortSignal,
  purpose?: "test",
): Promise<unknown> {
  const config = validateProviderConfig(rawConfig);
  const maxTokens = purpose === "test" ? 64 : 450;
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const conversation = messages.filter((m) => m.role !== "system");
  const body =
    config.protocol === "anthropic"
      ? {
          model: config.model,
          max_tokens: maxTokens,
          temperature: 0,
          system,
          messages: conversation,
        }
      : config.protocol === "gemini"
        ? {
            systemInstruction: { parts: [{ text: system }] },
            contents: conversation.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              temperature: 0,
              maxOutputTokens: maxTokens,
              responseMimeType: "application/json",
            },
          }
        : {
            model: config.model,
            ...(config.protocol === "cohere" ? { temperature: 0 } : {}),
            max_tokens: maxTokens,
            messages,
            ...(config.preset === "openai"
              ? { response_format: { type: "json_object" } }
              : {}),
          };
  const result = await post(config, body, signal);
  // Never follow redirects or surface provider text: it may contain secrets or URLs.
  checkStatus(result.status);
  try {
    const value: unknown = JSON.parse(result.text);
    if (config.protocol === "gemini") {
      const native = value as {
        promptFeedback?: { blockReason?: string };
        candidates?: { finishReason?: string }[];
      };
      const block = native.promptFeedback?.blockReason;
      const finish = native.candidates?.[0]?.finishReason;
      if (
        (block && block !== "BLOCK_REASON_UNSPECIFIED") ||
        (finish &&
          [
            "SAFETY",
            "RECITATION",
            "BLOCKLIST",
            "PROHIBITED_CONTENT",
            "SPII",
            "IMAGE_SAFETY",
          ].includes(finish))
      )
        throw new ProviderError(
          502,
          "AI_SAFETY",
          "AI provider blocked the response. Try revising the request.",
        );
      if (finish && finish !== "STOP" && finish !== "FINISH_REASON_UNSPECIFIED")
        throw new ProviderError(
          502,
          "AI_INCOMPLETE",
          "AI provider did not complete the response. Try again or select another model.",
        );
    }
    if (config.protocol === "anthropic") {
      const stop = (value as { stop_reason?: string }).stop_reason;
      if (stop === "refusal")
        throw new ProviderError(
          502,
          "AI_SAFETY",
          "AI provider blocked the response. Try revising the request.",
        );
      if (stop && stop !== "end_turn" && stop !== "stop_sequence")
        throw new ProviderError(
          502,
          "AI_INCOMPLETE",
          "AI provider did not complete the response. Try again or select another model.",
        );
    }
    if (config.protocol === "cohere") {
      const finish = (value as { finish_reason?: string }).finish_reason;
      if (finish && finish !== "COMPLETE")
        throw new ProviderError(
          502,
          "AI_INCOMPLETE",
          "AI provider did not complete the response. Try again or select another model.",
        );
    }
    const content =
      config.protocol === "cohere"
        ? (
            value as {
              message?: { content?: { type?: string; text?: unknown }[] };
            }
          ).message?.content
            ?.filter((part) => part.type === "text")
            .map((part) => {
              if (typeof part.text !== "string") throw new Error();
              return part.text;
            })
            .join("")
        : config.protocol === "anthropic"
          ? (value as { content?: { type?: string; text?: unknown }[] }).content
              ?.filter((part) => part.type === "text")
              .map((part) => {
                if (typeof part.text !== "string") throw new Error();
                return part.text;
              })
              .join("")
          : config.protocol === "gemini"
            ? (
                value as {
                  candidates?: { content?: { parts?: { text?: unknown }[] } }[];
                }
              ).candidates?.[0]?.content?.parts?.[0]?.text
            : (value as { choices?: { message?: { content?: unknown } }[] })
                .choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length > 8000) throw new Error();
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new Error("AI response invalid.");
  }
}

/** Discover native models without repository content; never select a model implicitly. */
export async function discoverModels(
  rawConfig: ProviderConfig,
  signal: AbortSignal,
): Promise<{ models: string[]; truncated: boolean }> {
  const config = validateProviderConfig(rawConfig);
  if (
    config.protocol !== "gemini" &&
    config.protocol !== "anthropic" &&
    !(config.preset in hostedPresets) &&
    !(config.preset in manualPresets) &&
    !["openai", "custom", "local"].includes(config.preset)
  )
    throw invalid();
  const models = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await post(config, {}, signal, { pageToken: token });
    checkStatus(result.status);
    let data: {
      models?: {
        name?: unknown;
        supportedGenerationMethods?: unknown;
        supportsServerless?: unknown;
        conversationConfig?: unknown;
        endpoints?: unknown;
      }[];
      data?: {
        id?: unknown;
        type?: unknown;
        providers?: { status?: unknown }[];
      }[];
      next_page_token?: unknown;
      nextPageToken?: unknown;
      has_more?: unknown;
      last_id?: unknown;
    };
    try {
      data = JSON.parse(result.text);
    } catch {
      throw unavailable();
    }
    if (!data || typeof data !== "object") throw unavailable();
    if (config.protocol === "gemini") {
      if (!Array.isArray(data.models)) throw unavailable();
      for (const item of data.models)
        if (
          typeof item?.name === "string" &&
          /^models\/[a-zA-Z0-9._-]{1,128}$/.test(item.name) &&
          Array.isArray(item.supportedGenerationMethods) &&
          item.supportedGenerationMethods.includes("generateContent")
        )
          models.add(item.name.slice(7));
      token =
        typeof data.nextPageToken === "string" &&
        data.nextPageToken.length <= 512
          ? data.nextPageToken
          : undefined;
    } else if (config.preset === "cohere") {
      if (!Array.isArray(data.models)) throw unavailable();
      for (const item of data.models)
        if (
          typeof item?.name === "string" &&
          /^[a-zA-Z0-9._-]{1,128}$/.test(item.name) &&
          Array.isArray(item.endpoints) &&
          item.endpoints.includes("chat")
        )
          models.add(item.name);
      token =
        typeof data.next_page_token === "string" &&
        data.next_page_token.length <= 512
          ? data.next_page_token
          : undefined;
    } else if (config.preset === "huggingface") {
      if (!Array.isArray(data.data)) throw unavailable();
      for (const item of data.data)
        if (
          typeof item?.id === "string" &&
          /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(item.id) &&
          item.id.length <= 128 &&
          Array.isArray(item.providers) &&
          item.providers.some((provider) => provider?.status === "live")
        )
          models.add(item.id);
      return { models: [...models].sort(), truncated: false };
    } else if (config.preset === "fireworks") {
      if (!Array.isArray(data.models)) throw unavailable();
      for (const item of data.models)
        if (
          typeof item?.name === "string" &&
          /^accounts\/fireworks\/models\/[a-zA-Z0-9._-]{1,100}$/.test(
            item.name,
          ) &&
          (!config.key || !item.name.includes(config.key)) &&
          item.supportsServerless === true &&
          item.conversationConfig &&
          typeof item.conversationConfig === "object" &&
          !Array.isArray(item.conversationConfig)
        )
          models.add(item.name);
      token =
        typeof data.nextPageToken === "string" &&
        data.nextPageToken.length <= 512
          ? data.nextPageToken
          : undefined;
    } else if (config.preset === "sambanova" || config.preset === "novita") {
      if (!Array.isArray(data.data)) throw unavailable();
      const documented = manualPresets[config.preset].discoveryModel;
      if (
        data.data.some(
          (item) =>
            item?.id === documented && !documented.includes(config.key!),
        )
      )
        models.add(documented);
      return { models: [...models], truncated: data.has_more === true };
    } else if (config.preset in hostedPresets) {
      const entries = config.preset === "together" ? data : data.data;
      if (!Array.isArray(entries)) throw unavailable();
      const vetted =
        hostedPresets[config.preset as keyof typeof hostedPresets].model;
      if (config.preset === "together") {
        for (const item of entries)
          if (
            typeof item?.id === "string" &&
            /^[a-zA-Z0-9._:/-]{1,128}$/.test(item.id) &&
            (!config.key || !item.id.includes(config.key)) &&
            item.type === "chat"
          )
            models.add(item.id);
        return { models: [...models].sort(), truncated: false };
      }
      if (
        entries.some(
          (item) =>
            item?.id === vetted &&
            (config.preset !== "together" || item.type === "chat"),
        )
      )
        models.add(vetted);
      return { models: [...models].sort(), truncated: false };
    } else if (["openai", "custom", "local"].includes(config.preset)) {
      if (!Array.isArray(data.data)) throw unavailable();
      for (const item of data.data)
        if (
          typeof item?.id === "string" &&
          /^[a-zA-Z0-9._:/-]{1,128}$/.test(item.id) &&
          (!config.key || !item.id.includes(config.key)) &&
          (config.preset !== "openai" ||
            [
              "gpt-4o",
              "gpt-4o-mini",
              "gpt-4.1",
              "gpt-4.1-mini",
              "gpt-4.1-nano",
            ].includes(item.id))
        )
          models.add(item.id);
      // Catalogs do not attest chat compatibility; custom/local selection is manual.
      return { models: [...models].sort(), truncated: data.has_more === true };
    } else {
      if (!Array.isArray(data.data)) throw unavailable();
      for (const item of data.data)
        if (
          typeof item?.id === "string" &&
          /^[a-zA-Z0-9._-]{1,128}$/.test(item.id)
        )
          models.add(item.id);
      token =
        data.has_more === true &&
        typeof data.last_id === "string" &&
        data.last_id.length <= 512
          ? data.last_id
          : undefined;
    }
    if (!token) return { models: [...models].sort(), truncated: false };
  }
  return { models: [...models].sort(), truncated: true };
}
