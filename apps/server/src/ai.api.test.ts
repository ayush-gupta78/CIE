import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { mockedProvider } from "./aiTestProvider.fixture.js";

const app = createApp(mockedProvider);
const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const request = (method: string, url: string, payload?: object) =>
  app.inject({ method, url, headers, payload });
const root = await mkdtemp(join(tmpdir(), "cie-ai-"));
afterEach(() => vi.unstubAllGlobals());

it("defaults off, keeps credentials private, retrieves verified source and rejects fabricated citations", async () => {
  await writeFile(
    join(root, "a.ts"),
    "import './b';\nconst secret = 'AKIAABCDEFGHIJKLMNOP';\n",
  );
  await writeFile(join(root, "b.ts"), "export const useful = 1;\n");
  const selected = (
    await request("POST", "/api/v1/repository/select", { path: root })
  ).json();
  const graph = (
    await request("POST", "/api/v1/repository/analyze", {
      repositoryId: selected.repositoryId,
      revision: selected.revision,
    })
  ).json();
  const body = {
    repositoryId: graph.repositoryId,
    revision: graph.revision,
    manifest: graph.manifest,
    question: "What imports useful?",
  };
  expect((await request("GET", "/api/v1/ai/config")).json()).toMatchObject({
    enabled: false,
    hasKey: false,
  });
  expect((await request("POST", "/api/v1/ai/ask", body)).statusCode).toBe(409);
  expect(
    (
      await request("PUT", "/api/v1/ai/config", {
        enabled: true,
        consent: true,
        apiKey: "sk-test-secret",
      })
    ).json(),
  ).toMatchObject({ enabled: true, consent: true, hasKey: true });
  expect(
    JSON.stringify((await request("GET", "/api/v1/ai/config")).json()),
  ).not.toContain("sk-test-secret");
  let sent = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      sent = String(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "a imports b",
                  citations: [
                    {
                      fileId: graph.files.find(
                        (f: { path: string }) => f.path === "a.ts",
                      ).id,
                      line: 1,
                      quote: "import './b';",
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    }),
  );
  const response = await request("POST", "/api/v1/ai/ask", body);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    grounding: "cited",
    citations: [{ line: 1 }],
  });
  expect(sent).toContain("import './b';");
  expect(sent).not.toContain("AKIAABCDEFGHIJKLMNOP");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: "invented",
                    citations: [
                      { fileId: "0".repeat(64), line: 1, quote: "invented" },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ),
  );
  expect((await request("POST", "/api/v1/ai/ask", body)).statusCode).toBe(429);
  await new Promise((resolve) => setTimeout(resolve, 1050));
  expect((await request("POST", "/api/v1/ai/ask", body)).json()).toMatchObject({
    grounding: "insufficient",
    citations: [],
  });
  expect(
    (
      await request("POST", "/api/v1/ai/ask", {
        ...body,
        revision: String(body.revision),
      })
    ).statusCode,
  ).toBe(400);
  await writeFile(
    join(root, "a.ts"),
    "import './b';\nconst secret = 'AKIAABCDEFGHIJKLMNOP';\n// changed\n",
  );
  await new Promise((resolve) => setTimeout(resolve, 1050));
  expect((await request("POST", "/api/v1/ai/ask", body)).json()).toMatchObject({
    error: { code: "STALE_SOURCE" },
  });
  expect(
    (
      await request("POST", "/api/v1/ai/ask", {
        ...body,
        manifest: "0".repeat(64),
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("PUT", "/api/v1/ai/config", {
        enabled: false,
        consent: false,
      })
    ).json(),
  ).toMatchObject({ enabled: false, hasKey: false });
  expect((await request("POST", "/api/v1/ai/test", {})).statusCode).toBe(409);
  await request("PUT", "/api/v1/ai/config", {
    enabled: true,
    consent: true,
    apiKey: "sk-test-secret",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":false}' } }],
          }),
          { status: 200 },
        ),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 1050));
  expect((await request("POST", "/api/v1/ai/test", {})).statusCode).toBe(502);
  await app.close();
  await rm(root, { recursive: true, force: true });
});
