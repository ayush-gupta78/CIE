import { describe, expect, it, vi } from "vitest";
import { AiApproval } from "./aiApproval.js";
import { callProvider, type ProviderConfig } from "./aiProvider.js";
import { redactEvidence } from "./aiRedaction.js";

const config: ProviderConfig = {
  preset: "openai",
  protocol: "openai-compatible",
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4o-mini",
  providerName: "OpenAI",
  authMode: "bearer",
  key: "synthetic-key",
};
const snapshot = {
  repositoryId: "repo",
  revision: 1,
  manifest: "manifest",
  fileId: "file",
};
const messages = [
  { role: "system" as const, content: "Only answer from evidence." },
  {
    role: "user" as const,
    content: JSON.stringify({
      question: "safe",
      evidence: [{ lines: [{ line: 1, text: "ordinary evidence" }] }],
    }),
  },
];

describe("outbound approval", () => {
  it.each([
    [
      "openai-compatible",
      "openai",
      "https://api.openai.com/v1/chat/completions",
    ],
    ["anthropic", "anthropic", "https://api.anthropic.com/v1/messages"],
    [
      "gemini",
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta/models",
    ],
  ] as const)(
    "binds serialized %s evidence, including escaped adversarial syntax",
    (protocol, preset, endpoint) => {
      const approval = new AiApproval();
      const native = { ...config, protocol, preset, endpoint };
      const source = redactEvidence(
        String.raw`{"api\u005fkey":"synthetic-unsafe-value","password":"synthetic-unsafe-value","safe":"ordinary evidence"}`,
      ).text;
      const preview = approval.prepare(
        native,
        [
          {
            role: "user",
            content: JSON.stringify({ evidence: [{ text: source }] }),
          },
        ],
        snapshot,
      );
      expect(preview.payload).toContain("ordinary evidence");
      expect(preview.payload).not.toContain("synthetic-key");
      expect(preview.payload).not.toContain("synthetic-unsafe-value");
      expect(JSON.stringify(JSON.parse(preview.payload))).toBe(preview.payload);
    },
  );
  it("previews exactly the native serialized body, destination and snapshot without transmitting", async () => {
    const approval = new AiApproval();
    const send = vi.fn().mockResolvedValue({ answer: "ok" });
    const preview = approval.prepare(config, messages, snapshot, [
      "Heuristic redaction cannot guarantee every credential is removed.",
    ]);
    expect(send).not.toHaveBeenCalled();
    expect(preview.destination).toEqual({
      endpoint: config.endpoint,
      protocol: config.protocol,
      model: config.model,
      providerName: config.providerName,
    });
    expect(preview.snapshot).toEqual(snapshot);
    expect(preview.payload).toContain("ordinary evidence");
    expect(preview.payload).not.toContain(config.key);
    expect(preview.warnings).toContain(
      "Heuristic redaction cannot guarantee every credential is removed.",
    );
    expect(
      await approval.approve(
        preview.id,
        snapshot,
        config,
        async () => {},
        send,
      ),
    ).toEqual({ answer: "ok" });
    expect(send).toHaveBeenCalledWith(config, messages, preview.payload);
    await expect(
      approval.approve(preview.id, snapshot, config, async () => {}, send),
    ).rejects.toThrow("approval");
  });

  it("rejects changed snapshot, destination, stale evidence and expired approval before send", async () => {
    const approval = new AiApproval();
    const send = vi.fn();
    const first = approval.prepare(config, messages, snapshot);
    await expect(
      approval.approve(
        first.id,
        { ...snapshot, manifest: "new" },
        config,
        async () => {},
        send,
      ),
    ).rejects.toThrow("approval");
    const second = approval.prepare(config, messages, snapshot);
    await expect(
      approval.approve(
        second.id,
        snapshot,
        { ...config, model: "other" },
        async () => {},
        send,
      ),
    ).rejects.toThrow("approval");
    const third = approval.prepare(config, messages, snapshot);
    await expect(
      approval.approve(
        third.id,
        snapshot,
        config,
        async () => {
          throw Error("stale");
        },
        send,
      ),
    ).rejects.toThrow("stale");
    const fourth = approval.prepare(config, messages, snapshot);
    await expect(
      approval.approve(
        fourth.id,
        snapshot,
        config,
        async () => {},
        send,
        Date.now() + 61_000,
      ),
    ).rejects.toThrow("approval");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects mutation of prepared messages and invalidates superseded previews", async () => {
    const approval = new AiApproval();
    const send = vi.fn();
    const mutable = messages.map((message) => ({ ...message }));
    const old = approval.prepare(config, mutable, snapshot);
    mutable[1].content = "changed";
    await expect(
      approval.approve(old.id, snapshot, config, async () => {}, send),
    ).rejects.toThrow("approval");
    const superseded = approval.prepare(config, messages, snapshot);
    approval.prepare(config, messages, snapshot);
    await expect(
      approval.approve(superseded.id, snapshot, config, async () => {}, send),
    ).rejects.toThrow("approval");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects mutation while asynchronous freshness validation is running", async () => {
    const approval = new AiApproval();
    const mutable = messages.map((message) => ({ ...message }));
    const preview = approval.prepare(config, mutable, snapshot);
    const send = vi.fn();
    await expect(
      approval.approve(
        preview.id,
        snapshot,
        config,
        async () => {
          mutable[1].content = "synthetic-unsafe-value";
        },
        send,
      ),
    ).rejects.toThrow("approval");
    expect(send).not.toHaveBeenCalled();
  });
  it("rejects a changed provider destination during asynchronous validation", async () => {
    const approval = new AiApproval();
    const current: ProviderConfig = {
      ...config,
      preset: "custom",
      endpoint: "https://ai.example/v1/chat/completions",
    };
    const prepared = approval.prepare(current, messages, snapshot);
    const send = vi.fn();
    await expect(
      approval.approve(
        prepared.id,
        snapshot,
        current,
        async () => {
          current.endpoint = "https://other.example/v1/chat/completions";
        },
        send,
      ),
    ).rejects.toThrow("approval");
    expect(send).not.toHaveBeenCalled();
  });
  it("refuses serialized payloads or destination metadata containing the credential", () => {
    const approval = new AiApproval();
    expect(() =>
      approval.prepare(
        config,
        [{ role: "user", content: "synthetic-key" }],
        snapshot,
      ),
    ).toThrow("credential");
    expect(() =>
      approval.prepare(
        { ...config, model: "synthetic-key" },
        messages,
        snapshot,
      ),
    ).toThrow("credential");
    expect(() =>
      approval.prepare(
        { ...config, providerName: "synthetic-key" },
        messages,
        snapshot,
      ),
    ).toThrow("credential");
  });
  it("fails closed when final serialized metadata contains a newly introduced credential", () => {
    const approval = new AiApproval();
    expect(() =>
      approval.prepare(
        config,
        [
          {
            role: "user",
            content: JSON.stringify({
              diagnostics: [
                { path: "config.yaml", code: "api_key=synthetic-unsafe-value" },
              ],
            }),
          },
        ],
        snapshot,
      ),
    ).toThrow();
  });
  it("still previews ordinary authentication code without a credential value", () => {
    const approval = new AiApproval();
    const preview = approval.prepare(
      config,
      [
        {
          role: "user",
          content: JSON.stringify({
            question: "How is auth handled?",
            evidence: [
              {
                path: "auth.ts",
                lines: [
                  { line: 1, text: "const token = process.env.AUTH_TOKEN;" },
                ],
              },
            ],
          }),
        },
      ],
      snapshot,
    );
    expect(preview.payload).toContain("process.env.AUTH_TOKEN");
  });
  it("rejects changed serialized bytes at the provider-call boundary before transport", async () => {
    const approval = new AiApproval();
    const prepared = approval.prepare(config, messages, snapshot);
    await expect(
      callProvider(
        config,
        messages as Parameters<typeof callProvider>[1],
        new AbortController().signal,
        undefined,
        prepared.payload + " ",
      ),
    ).rejects.toMatchObject({ code: "AI_APPROVAL_INVALID" });
  });
});
