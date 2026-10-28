import { ApiError, request } from "./repositoryApi";
import type { FileNode, Graph } from "./graphApi";

export type Source = {
  repositoryId: string;
  revision: number;
  manifest: string;
  fileId: string;
  path: string;
  name: string;
  language: string;
  status: FileNode["status"];
  freshness: "verified" | "unverified";
  text: string;
  lineCount: number;
};

export async function getSource(
  graph: Pick<Graph, "repositoryId" | "revision" | "manifest">,
  file: Pick<FileNode, "id" | "path" | "name" | "language" | "status">,
  signal?: AbortSignal,
): Promise<Source> {
  const params = new URLSearchParams({
    repositoryId: graph.repositoryId,
    revision: String(graph.revision),
    manifest: graph.manifest,
    fileId: file.id,
  });
  const result = await request(`/api/v1/repository/source?${params}`, {
    signal,
  });
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !("repositoryId" in result) ||
    result.repositoryId !== graph.repositoryId ||
    !("revision" in result) ||
    result.revision !== graph.revision ||
    !("manifest" in result) ||
    result.manifest !== graph.manifest ||
    !("fileId" in result) ||
    result.fileId !== file.id ||
    !("path" in result) ||
    result.path !== file.path ||
    !("name" in result) ||
    result.name !== file.name ||
    !("language" in result) ||
    result.language !== file.language ||
    !("status" in result) ||
    result.status !== file.status ||
    !("freshness" in result) ||
    (result.freshness !== "verified" && result.freshness !== "unverified") ||
    !("text" in result) ||
    typeof result.text !== "string" ||
    new TextEncoder().encode(result.text).length > 256 * 1024 ||
    !("lineCount" in result) ||
    !Number.isSafeInteger(result.lineCount) ||
    (result.lineCount as number) < 0 ||
    (result.lineCount as number) > 5000 ||
    result.lineCount !==
      (result.text
        ? result.text.split("\n").length - Number(result.text.endsWith("\n"))
        : 0)
  )
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned invalid source evidence.",
    );
  return result as Source;
}
