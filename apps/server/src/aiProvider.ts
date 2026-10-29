import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export type ProviderConfig = {
  preset: "openai" | "custom" | "local";
  protocol: "openai-compatible";
  endpoint: string;
  model: string;
  providerName: string;
  authMode: "bearer" | "none";
  key?: string;
};
export type ProviderCaller = (
  config: ProviderConfig,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
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
const hasControl = (text: string) =>
  [...text].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );

// Conservative IANA special-purpose denylist:
// https://www.iana.org/assignments/iana-ipv4-special-registry/ and
// https://www.iana.org/assignments/iana-ipv6-special-registry/.
// Only a validated public IPv4 address is dialed.
function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c, d] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 168 && b === 63 && c === 129 && d === 16) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 &&
      ((b === 0 && (c === 0 || c === 2)) ||
        b === 168 ||
        (b === 88 && c === 99) ||
        (b === 31 && c === 196) ||
        (b === 52 && c === 193) ||
        (b === 175 && c === 48))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function publicIPv6Answer(address: string): boolean {
  if (isIP(address) !== 6) return false;
  // Normalize alternate textual spellings such as 2001:0db8::1.
  const [firstText, secondText, thirdText] = new URL(
    `http://[${address}]`,
  ).hostname
    .slice(1, -1)
    .split(":");
  const first = parseInt(firstText, 16);
  const second = parseInt(secondText || "0", 16);
  const third = parseInt(thirdText || "0", 16);
  return (
    first >= 0x2000 &&
    first < 0x4000 &&
    !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    first !== 0x2002 &&
    first !== 0x3fff &&
    !(first === 0x2620 && second === 0x004f && third === 0x8000)
  );
}

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
    !["openai", "custom", "local"].includes(v.preset as string) ||
    v.protocol !== "openai-compatible" ||
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
  return {
    preset: v.preset as ProviderConfig["preset"],
    protocol: "openai-compatible",
    endpoint: url.href,
    model: v.model as string,
    providerName: v.providerName as string,
    authMode: v.authMode as ProviderConfig["authMode"],
    ...(v.key === undefined ? {} : { key: v.key as string }),
  };
}

async function pinnedAddress(
  url: URL,
  local: boolean,
): Promise<{ address: string; family: 4 | 6 }> {
  if (local)
    return url.hostname === "[::1]"
      ? { address: "::1", family: 6 }
      : { address: "127.0.0.1", family: 4 };
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  // Use IPv4 only, but reject any unsafe DNS answer (including IPv6) rather than
  // allowing a mixed public/private answer to bypass the destination policy.
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) => !publicIPv4(address) && !publicIPv6Answer(address),
    )
  )
    throw unavailable();
  const selected = addresses.find(({ address }) => isIP(address) === 4);
  if (!selected) throw unavailable();
  return { address: selected.address, family: 4 };
}

async function post(
  config: ProviderConfig,
  body: object,
  signal: AbortSignal,
): Promise<{ status: number; text: string }> {
  const url = new URL(config.endpoint);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  let onAbort = () => {};
  const canceled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(unavailable());
    if (combined.aborted) onAbort();
    else combined.addEventListener("abort", onAbort, { once: true });
  });
  let address: { address: string; family: 4 | 6 };
  try {
    address = await Promise.race([
      pinnedAddress(url, config.preset === "local"),
      canceled,
    ]);
  } catch {
    throw unavailable();
  } finally {
    combined.removeEventListener("abort", onAbort);
  }
  if (combined.aborted) throw unavailable();
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "POST",
        signal: combined,
        family: address.family,
        lookup: (_host, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          "content-type": "application/json",
          ...(config.authMode === "bearer"
            ? { authorization: `Bearer ${config.key}` }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 16000) {
            req.destroy();
            reject(new Error("AI response too large."));
          } else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 502,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", () => reject(unavailable()));
      },
    );
    req.on("error", () => reject(unavailable()));
    req.setTimeout(12000, () => req.destroy());
    req.end(JSON.stringify(body));
  });
}

/** POST a chat completion; return parsed JSON message content. Caller owns the AbortSignal. */
export async function callProvider(
  rawConfig: ProviderConfig,
  messages: { role: string; content: string }[],
  signal: AbortSignal,
): Promise<unknown> {
  const config = validateProviderConfig(rawConfig);
  const body = {
    model: config.model,
    temperature: 0,
    max_tokens: 450,
    messages,
    ...(config.preset === "openai"
      ? { response_format: { type: "json_object" } }
      : {}),
  };
  const result = await post(config, body, signal);
  // Never follow redirects or surface provider text: it may contain secrets or URLs.
  if (result.status === 401 || result.status === 403)
    throw new ProviderError(
      502,
      "AI_AUTH",
      "AI provider rejected credentials.",
    );
  if (result.status === 429)
    throw new ProviderError(
      429,
      "AI_RATE_LIMIT",
      "AI provider rate limit reached.",
    );
  if (result.status < 200 || result.status >= 300) throw unavailable();
  try {
    const value: unknown = JSON.parse(result.text);
    const content = (
      value as { choices?: { message?: { content?: unknown } }[] }
    ).choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length > 8000) throw new Error();
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error("AI response invalid.");
  }
}
