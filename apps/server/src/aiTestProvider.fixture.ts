import type { ProviderCaller } from "./aiProvider.js";

// The integration suites stub fetch; production uses the pinned HTTP transport.
export const mockedProvider: ProviderCaller = async (
  _config,
  messages,
  signal,
) => {
  if (messages[1]?.content === "Connectivity test. No repository content.")
    return { ok: true };
  const result = await fetch("http://test.invalid", {
    method: "POST",
    body: JSON.stringify({ messages }),
    signal,
  });
  const payload = (await result.json()) as {
    choices: { message: { content: string } }[];
  };
  return JSON.parse(payload.choices[0].message.content) as unknown;
};
