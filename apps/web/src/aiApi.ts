import { ApiError, json, request } from "./repositoryApi";
import type { Graph } from "./graphApi";

export type AiConfig = {
  enabled: boolean;
  providerName: string;
  protocol: "openai-compatible" | "gemini" | "anthropic" | "cohere";
  endpointUrl: string;
  model: string;
  authMode: "bearer" | "none";
  local: boolean;
  hasKey: boolean;
  consent: boolean;
  connectionStatus?: "untested" | "verified" | "failed";
  preset?:
    | "openai"
    | "custom"
    | "local"
    | "gemini"
    | "anthropic"
    | "openrouter"
    | "nvidia"
    | "groq"
    | "deepseek"
    | "mistral"
    | "cerebras"
    | "together"
    | "xai"
    | "fireworks"
    | "sambanova"
    | "novita"
    | "cohere"
    | "huggingface";
};
export type AiCitation = {
  fileId: string;
  path: string;
  startLine?: number;
  endLine?: number;
  category: string;
  edgeId?: string;
  freshness: string;
  quote?: string;
};
export type AiAnswer = {
  status: "cited" | "insufficient";
  answer: string;
  citations: AiCitation[];
  limitations: string[];
  warnings: string[];
  repositoryId: string;
  revision: number;
  manifest: string;
  provider: string;
  model: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const endpoint = (v: unknown): v is string => {
  if (!text(v)) return false;
  try {
    const url = new URL(v);
    return (
      !!url.hostname && (url.protocol === "https:" || url.protocol === "http:")
    );
  } catch {
    return false;
  }
};
const invalid = () =>
  new ApiError(
    "INVALID_RESPONSE",
    "Local API returned invalid assistant data.",
  );

function config(value: unknown): AiConfig {
  if (
    !record(value) ||
    typeof value.enabled !== "boolean" ||
    !text(value.providerName) ||
    !["openai-compatible", "gemini", "anthropic", "cohere"].includes(
      String(value.protocol),
    ) ||
    !endpoint(value.endpointUrl) ||
    !text(value.model) ||
    (value.authMode !== "bearer" && value.authMode !== "none") ||
    typeof value.local !== "boolean" ||
    typeof value.hasKey !== "boolean" ||
    typeof value.consent !== "boolean" ||
    (value.connectionStatus !== undefined &&
      !["untested", "verified", "failed"].includes(
        String(value.connectionStatus),
      ))
  )
    throw invalid();
  if (
    typeof value.preset === "string" &&
    Object.hasOwn(trustedEndpoints, value.preset)
  ) {
    const preset = value.preset as keyof typeof trustedEndpoints;
    if (
      value.endpointUrl !== trustedEndpoints[preset] ||
      value.local ||
      value.authMode !== "bearer" ||
      value.protocol !==
        (preset === "gemini" || preset === "anthropic" || preset === "cohere"
          ? preset
          : "openai-compatible")
    )
      throw invalid();
  }
  return value as AiConfig;
}
const trustedEndpoints = {
  sambanova: "https://api.sambanova.ai/v1/chat/completions",
  novita: "https://api.novita.ai/openai/v1/chat/completions",
  cohere: "https://api.cohere.com/v2/chat",
  huggingface: "https://router.huggingface.co/v1/chat/completions",
  fireworks: "https://api.fireworks.ai/inference/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  together: "https://api.together.ai/v1/chat/completions",
} as const;
export type NativeProvider = Omit<
  AiConfig,
  "enabled" | "consent" | "hasKey" | "preset"
> & { preset: keyof typeof trustedEndpoints };
export async function getNativeProviders(
  signal?: AbortSignal,
): Promise<NativeProvider[]> {
  const result = await request("/api/v1/ai/providers", { signal });
  if (!record(result) || !Array.isArray(result.providers)) throw invalid();
  return result.providers.filter((v: unknown): v is NativeProvider => {
    if (
      !record(v) ||
      typeof v.preset !== "string" ||
      !Object.hasOwn(trustedEndpoints, v.preset)
    )
      return false;
    const preset = v.preset as keyof typeof trustedEndpoints;
    return (
      (preset === "gemini" || preset === "anthropic" || preset === "cohere"
        ? v.protocol === preset
        : v.protocol === "openai-compatible") &&
      v.endpointUrl === trustedEndpoints[preset] &&
      text(v.providerName) &&
      (text(v.model) ||
        ((preset === "cohere" ||
          preset === "huggingface" ||
          preset === "sambanova" ||
          preset === "novita") &&
          v.model === "")) &&
      v.authMode === "bearer" &&
      v.local === false
    );
  });
}
export async function discoverAiModels(): Promise<{
  models: string[];
  truncated: boolean;
}> {
  const result = await request("/api/v1/ai/models", json("POST", {}));
  if (
    !record(result) ||
    !Array.isArray(result.models) ||
    !result.models.every(text) ||
    typeof result.truncated !== "boolean"
  )
    throw invalid();
  return { models: result.models, truncated: result.truncated };
}
export async function getAiConfig(signal?: AbortSignal): Promise<AiConfig> {
  return config(await request("/api/v1/ai/config", { signal }));
}
export async function putAiConfig(
  value: Omit<AiConfig, "hasKey"> & { apiKey?: string | null },
  signal?: AbortSignal,
): Promise<AiConfig> {
  return config(await request("/api/v1/ai/config", json("PUT", value, signal)));
}
export async function testAiConfig(signal?: AbortSignal): Promise<unknown> {
  const result = await request("/api/v1/ai/test", json("POST", {}, signal));
  if (!record(result) || result.ok !== true) throw invalid();
  return result;
}
export async function askAi(
  graph: Graph,
  question: string,
  fileId?: string,
  signal?: AbortSignal,
): Promise<AiAnswer> {
  const result = await request(
    "/api/v1/ai/ask",
    json(
      "POST",
      {
        repositoryId: graph.repositoryId,
        revision: graph.revision,
        manifest: graph.manifest,
        question,
        ...(fileId ? { fileId } : {}),
      },
      signal,
    ),
  );
  if (
    !record(result) ||
    result.repositoryId !== graph.repositoryId ||
    result.revision !== graph.revision ||
    result.manifest !== graph.manifest ||
    (result.status !== "cited" && result.status !== "insufficient") ||
    typeof result.answer !== "string" ||
    !Array.isArray(result.citations) ||
    !result.citations.every(
      (citation: unknown) =>
        record(citation) &&
        text(citation.fileId) &&
        text(citation.path) &&
        text(citation.category) &&
        text(citation.freshness) &&
        (citation.quote === undefined || text(citation.quote)) &&
        (citation.edgeId === undefined || text(citation.edgeId)) &&
        (citation.startLine === undefined ||
          (Number.isSafeInteger(citation.startLine) &&
            (citation.startLine as number) > 0)) &&
        (citation.endLine === undefined ||
          (Number.isSafeInteger(citation.endLine) &&
            (citation.endLine as number) > 0)) &&
        (citation.endLine === undefined ||
          (typeof citation.startLine === "number" &&
            (citation.endLine as number) >= citation.startLine)),
    ) ||
    !Array.isArray(result.limitations) ||
    !result.limitations.every((v: unknown) => typeof v === "string") ||
    !Array.isArray(result.warnings) ||
    !result.warnings.every((v: unknown) => typeof v === "string") ||
    !text(result.provider) ||
    !text(result.model) ||
    (result.status === "insufficient" && result.citations.length !== 0)
  )
    throw invalid();
  return result as AiAnswer;
}

// A model's citation is a claim, not a source. Resolve every identifier against the published graph.
export function verifiedCitation(graph: Graph, citation: AiCitation): boolean {
  if (citation.freshness !== "verified") return false;
  const file = graph.files.find(
    (item) => item.id === citation.fileId && item.path === citation.path,
  );
  if (!file) return false;
  if (citation.edgeId) {
    const edge = graph.edges.find(
      (item) =>
        item.id === citation.edgeId &&
        item.from === file.id &&
        item.evidence.path === file.path &&
        item.resolution === "resolved_static" &&
        !!item.to,
    );
    if (
      !edge ||
      (citation.startLine !== undefined &&
        edge.evidence.line !== citation.startLine)
    )
      return false;
  }
  return true;
}
