import { expect, it } from "vitest";
import { createApp } from "./app.js";

const headers = { host: "127.0.0.1:3001", origin: "http://127.0.0.1:5173" };
it("requires a verified connection before an answer and isolates provider switches", async () => {
  let purpose: string | undefined;
  const app = createApp(async (_config, _messages, _signal, callPurpose) => {
    purpose = callPurpose;
    return { ok: true };
  });
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    const initial = await req("GET", "/api/v1/ai/config");
    expect(initial.json().connectionStatus).toBe("untested");
    expect((await req("POST", "/api/v1/ai/models", {})).statusCode).toBe(409);
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      apiKey: "example-key",
    });
    const ask = {
      repositoryId: "fake",
      revision: 1,
      manifest: "fake",
      question: "question",
    };
    const blocked = await req("POST", "/api/v1/ai/ask", ask);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("AI_NOT_CONNECTED");
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(200);
    expect(purpose).toBe("test");
    expect(
      (await req("GET", "/api/v1/ai/config")).json().connectionStatus,
    ).toBe("verified");
    const switched = await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      preset: "gemini",
      protocol: "gemini",
      providerName: "Gemini",
      endpointUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      model: "gemini-2.5-flash",
      authMode: "bearer",
      apiKey: "new-key",
    });
    expect(switched.json()).toMatchObject({
      connectionStatus: "untested",
      consent: false,
      hasKey: false,
    });
    expect(
      (await req("GET", "/api/v1/ai/providers"))
        .json()
        .providers.map((p: { preset: string }) => p.preset),
    ).toContain("gemini");
  } finally {
    await app.close();
  }
});

it("failed connectivity does not mark the provider connected", async () => {
  const app = createApp(async () => ({ ok: false }));
  const req = (method: string, url: string, payload?: object) =>
    app.inject({ method, url, headers, payload });
  try {
    await req("PUT", "/api/v1/ai/config", {
      enabled: true,
      consent: true,
      apiKey: "example-key",
    });
    expect((await req("POST", "/api/v1/ai/test", {})).statusCode).toBe(502);
    expect(
      (await req("GET", "/api/v1/ai/config")).json().connectionStatus,
    ).toBe("failed");
  } finally {
    await app.close();
  }
});
