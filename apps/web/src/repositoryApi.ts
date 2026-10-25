export type Selection = {
  selected: true;
  repositoryId: string;
  revision: number;
  rootName: string;
};
export type Entry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  sizeBytes?: number;
  modifiedAt?: string;
  languageHint?: string;
};
export type Page = {
  repositoryId: string;
  revision: number;
  dir: string;
  entries: Entry[];
  nextCursor: string | null;
};

const messages: Record<string, string> = {
  INVALID_INPUT:
    "Enter a valid absolute directory path or refresh the directory.",
  NOT_FOUND: "Directory not found. Check the path and try again.",
  FORBIDDEN_PATH:
    "Directory is inaccessible, excluded, or has changed. Choose another directory.",
  NO_REPOSITORY_SELECTED: "No repository is selected. Open one first.",
  STALE_REPOSITORY: "Repository view changed. Refresh or choose it again.",
  DIRECTORY_TOO_LARGE:
    "This directory exceeds the browsing limit of 5,000 entries.",
  IGNORE_TOO_LARGE: "An ignore file exceeds the supported size of 256 KiB.",
  UNAVAILABLE:
    "Local directory is unavailable. Retry or choose another directory.",
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const selection = (value: unknown): value is Selection =>
  object(value) &&
  value.selected === true &&
  typeof value.repositoryId === "string" &&
  !!value.repositoryId &&
  Number.isSafeInteger(value.revision) &&
  typeof value.rootName === "string" &&
  !!value.rootName;
const entry = (value: unknown): value is Entry =>
  object(value) &&
  typeof value.name === "string" &&
  !!value.name &&
  typeof value.path === "string" &&
  !!value.path &&
  !value.path.startsWith("/") &&
  !value.path
    .split("/")
    .some((part) => !part || part === "." || part === "..") &&
  (value.kind === "file" || value.kind === "directory") &&
  (value.sizeBytes === undefined ||
    (Number.isSafeInteger(value.sizeBytes) &&
      (value.sizeBytes as number) >= 0)) &&
  (value.modifiedAt === undefined || typeof value.modifiedAt === "string") &&
  (value.languageHint === undefined || typeof value.languageHint === "string");

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError(
      "OFFLINE",
      "Local API is offline. Retry connection when it is available.",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an unreadable response.",
    );
  }
  if (!response.ok) {
    const code =
      object(data) && object(data.error) && typeof data.error.code === "string"
        ? data.error.code
        : "UNAVAILABLE";
    throw new ApiError(
      code,
      messages[code] ?? "Local request failed. Retry shortly.",
    );
  }
  return data;
}
const json = (
  method: string,
  body: object,
  signal?: AbortSignal,
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal,
});
export async function currentRepository(
  signal?: AbortSignal,
): Promise<Selection | null> {
  const result = await request("/api/v1/repository", { signal });
  if (object(result) && result.selected === false) return null;
  if (!selection(result))
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid repository state.",
    );
  return result;
}
export async function selectRepository(
  path: string,
  signal?: AbortSignal,
): Promise<Selection> {
  const result = await request(
    "/api/v1/repository/select",
    json("POST", { path }, signal),
  );
  if (!selection(result))
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid repository state.",
    );
  return result;
}
export async function rescanRepository(
  signal?: AbortSignal,
): Promise<Selection> {
  const result = await request(
    "/api/v1/repository/rescan",
    json("POST", {}, signal),
  );
  if (!selection(result))
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid repository state.",
    );
  return result;
}
export async function closeRepository(signal?: AbortSignal): Promise<void> {
  const result = await request(
    "/api/v1/repository",
    json("DELETE", {}, signal),
  );
  if (!object(result) || result.selected !== false)
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid repository state.",
    );
}
export async function directoryPage(
  repo: Selection,
  dir: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<Page> {
  const params = new URLSearchParams({
    dir,
    repositoryId: repo.repositoryId,
    revision: String(repo.revision),
    limit: "100",
  });
  if (cursor) params.set("cursor", cursor);
  const result = await request(`/api/v1/repository/tree?${params}`, { signal });
  if (
    !object(result) ||
    result.repositoryId !== repo.repositoryId ||
    result.revision !== repo.revision ||
    result.dir !== dir ||
    !Array.isArray(result.entries) ||
    !result.entries.every(entry) ||
    !(result.nextCursor === null || typeof result.nextCursor === "string")
  )
    throw new ApiError(
      "INVALID_RESPONSE",
      "Local API returned an invalid directory listing.",
    );
  return result as Page;
}
