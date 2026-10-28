import { ApiError, json, request } from "./repositoryApi";
import type { Graph } from "./graphApi";

export type AiConfig = {
  enabled: boolean;
  provider: "openai";
  model: "gpt-4o-mini";
  hasKey: boolean;
  consent: boolean;
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
  model: "gpt-4o-mini";
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const invalid = () =>
  new ApiError(
    "INVALID_RESPONSE",
    "Local API returned invalid assistant data.",
  );

function config(value: unknown): AiConfig {
  if (
    !record(value) ||
    typeof value.enabled !== "boolean" ||
    value.provider !== "openai" ||
    value.model !== "gpt-4o-mini" ||
    typeof value.hasKey !== "boolean" ||
    typeof value.consent !== "boolean"
  )
    throw invalid();
  return value as AiConfig;
}
export async function getAiConfig(signal?: AbortSignal): Promise<AiConfig> {
  return config(await request("/api/v1/ai/config", { signal }));
}
export async function putAiConfig(
  value: {
    enabled: boolean;
    provider: "openai";
    model: string;
    apiKey?: string;
    consent: boolean;
  },
  signal?: AbortSignal,
): Promise<AiConfig> {
  if (value.model !== "gpt-4o-mini") throw invalid();
  return config(await request("/api/v1/ai/config", json("PUT", value, signal)));
}
export async function testAiConfig(signal?: AbortSignal): Promise<unknown> {
  return request("/api/v1/ai/test", json("POST", {}, signal));
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
    result.provider !== "openai" ||
    result.model !== "gpt-4o-mini" ||
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
