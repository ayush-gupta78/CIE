import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { ProviderConfig } from "./aiProvider.js";
import { hostedPresets } from "./aiProviderRegistry.js";

const unavailable = () => new Error("AI provider unavailable.");

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

export async function post(
  config: ProviderConfig,
  body: object,
  signal: AbortSignal,
  discovery?: { pageToken?: string },
): Promise<{ status: number; text: string }> {
  const url = new URL(config.endpoint);
  // Compatible discovery is restricted to the documented sibling endpoint;
  // never infer a host or replace arbitrary paths carrying credentials.
  if (discovery && ["openai", "custom", "local"].includes(config.preset)) {
    if (url.pathname !== "/v1/chat/completions") throw unavailable();
    url.pathname = "/v1/models";
  }
  if (discovery && config.protocol === "cohere") {
    url.pathname = "/v1/models";
    url.searchParams.set("endpoint", "chat");
  }
  if (discovery && config.preset === "huggingface") url.pathname = "/v1/models";
  if (
    discovery &&
    (config.preset === "sambanova" || config.preset === "novita")
  )
    url.pathname = url.pathname.replace(/chat\/completions$/, "models");
  if (discovery && config.protocol === "anthropic") url.pathname = "/v1/models";
  if (discovery && config.preset === "fireworks")
    url.pathname = "/v1/accounts/fireworks/models";
  else if (discovery && config.preset in hostedPresets)
    url.pathname = url.pathname.replace(/chat\/completions$/, "models");
  if (discovery?.pageToken)
    url.searchParams.set(
      config.protocol === "anthropic"
        ? "after_id"
        : config.protocol === "cohere"
          ? "page_token"
          : "pageToken",
      discovery.pageToken,
    );
  if (!discovery && config.protocol === "gemini")
    url.pathname += `/${encodeURIComponent(config.model)}:generateContent`;
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
        method: discovery ? "GET" : "POST",
        signal: combined,
        family: address.family,
        lookup: (_host, _options, callback) =>
          callback(null, address.address, address.family),
        headers: {
          "content-type": "application/json",
          ...(config.protocol === "anthropic"
            ? { "x-api-key": config.key!, "anthropic-version": "2023-06-01" }
            : config.protocol === "gemini"
              ? { "x-goog-api-key": config.key! }
              : config.authMode === "bearer"
                ? { authorization: `Bearer ${config.key}` }
                : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (
            size >
            (discovery &&
            (config.preset in hostedPresets ||
              config.preset === "sambanova" ||
              config.preset === "novita" ||
              config.preset === "huggingface" ||
              config.preset === "cohere")
              ? 2_000_000
              : 16000)
          ) {
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
    req.end(discovery ? undefined : JSON.stringify(body));
  });
}
