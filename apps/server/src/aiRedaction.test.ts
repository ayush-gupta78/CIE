import { describe, expect, it } from "vitest";
import { redactEvidence } from "./aiRedaction.js";

describe("redactEvidence", () => {
  it("keeps ordinary evidence and identifiers intact", () => {
    const text =
      "const token = process.env.API_TOKEN;\nconst passwordHash = hash(password);\nfunction useToken(token: string) {}";
    expect(redactEvidence(text)).toEqual({
      text,
      redactedCount: 0,
      omittedCount: 0,
      warnings: [],
    });
  });

  it("masks credential assignments across naming styles and quoted configuration keys", () => {
    const text = [
      'const clientSecret = "synthetic-client-value";',
      'const accessToken = "synthetic-access-value";',
      'const AWS_SECRET_ACCESS_KEY = "synthetic-aws-value";',
      'GITHUB_ACCESS_TOKEN: "synthetic-github-value",',
      'DATABASE_PASSWORD = "synthetic-database-value";',
      'AUTH_CLIENT_SECRET: "synthetic-auth-value",',
      '"refreshToken": "synthetic-refresh-value",',
      '"api-key": "synthetic-api-value",',
      'const ClientSecret = "synthetic-pascal-value";',
      "const secret = process.env.JWT_SECRET;",
      "const passwordHash = await hash(password);",
      "function validateToken(token: string) { return verifyToken(token); }",
      'publicName: "ordinary-value",',
    ].join("\n");
    const result = redactEvidence(text);
    expect(result.redactedCount).toBe(9);
    expect(result.omittedCount).toBe(0);
    expect(result.text.split("\n")).toHaveLength(text.split("\n").length);
    expect(result.text).toContain('const clientSecret = "[redacted]";');
    expect(result.text).toContain(
      'const AWS_SECRET_ACCESS_KEY = "[redacted]";',
    );
    expect(result.text).toContain('"refreshToken": "[redacted]"');
    expect(result.text).toContain('"api-key": "[redacted]"');
    expect(result.text).toContain('publicName: "ordinary-value"');
    expect(result.text).toContain("const secret = process.env.JWT_SECRET;");
    expect(result.text).toContain("const passwordHash = await hash(password);");
    expect(result.text).toContain("function validateToken(token: string)");
    expect(result.text).not.toContain("synthetic-client-value");
  });

  it("masks assigned values without discarding useful source lines", () => {
    const input = `const password = 'hidden password'; // check login\napi_key: "private-key"\nSECRET=opaque\nconst token = "sk-verylongprivate123";`;
    const result = redactEvidence(input);
    expect(result.text).toBe(
      `const password = '[redacted]'; // check login\napi_key: "[redacted]"\nSECRET=[redacted]\nconst token = "[redacted]";`,
    );
    expect(result.redactedCount).toBe(4);
    expect(result.omittedCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const secret of [
      "hidden password",
      "private-key",
      "opaque",
      "sk-verylongprivate123",
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it("does not leak an escaped quote inside a secret value", () => {
    const result = redactEvidence(
      "const password = 'hidden\\'suffix'; // keep",
    );
    expect(result.text).toBe("const password = '[redacted]'; // keep");
    expect(JSON.stringify(result)).not.toContain("suffix");
  });

  it("masks bearer credentials, URL credentials, query parameters and connection strings", () => {
    const input =
      "Authorization: Bearer abc.def-ghi\nhttps://alice:verysecret@example.com/path?token=abc123&mode=read\npostgres://alice:databasepass@db.example/app\nhttps://example.com/?api_key=key123&other=ok";
    const result = redactEvidence(input);
    for (const secret of [
      "abc.def-ghi",
      "verysecret",
      "databasepass",
      "abc123",
      "key123",
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(result.text).toContain("Bearer [redacted]");
    expect(result.text).toContain("/path?token=[redacted]&mode=read");
    expect(result.text).toContain("?api_key=[redacted]&other=ok");
    expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
  });

  it("masks compound credential names while keeping environment references", () => {
    const input =
      "const token = process.env['TOKEN'];\nclient_secret: 'client value'\nhttps://host/?access_token=accessvalue&safe=yes";
    const result = redactEvidence(input);
    expect(result.text).toBe(
      "const token = process.env['TOKEN'];\nclient_secret: '[redacted]'\nhttps://host/?access_token=[redacted]&safe=yes",
    );
    expect(JSON.stringify(result)).not.toContain("client value");
    expect(JSON.stringify(result)).not.toContain("accessvalue");
  });

  it("masks standalone known credential formats without swallowing neighbors", () => {
    const input =
      "key AKIAABCDEFGHIJKLMNOP next\naccess sk-abcdefghijklmnopqrstuvwxyz123456 done\npat ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd next";
    const result = redactEvidence(input);
    expect(result.text).toBe(
      "key [redacted] next\naccess [redacted] done\npat [redacted] next",
    );
    expect(result.redactedCount).toBe(3);
  });

  it("omits complete private-key blocks while preserving line positions, including unterminated blocks", () => {
    const input =
      "before\n-----BEGIN PRIVATE KEY-----\nbase64payload\n-----END PRIVATE KEY-----\nafter\n-----BEGIN RSA PRIVATE KEY-----\nmorepayload";
    const result = redactEvidence(input);
    expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
    expect(result.text).toContain(
      "before\n[omitted: private key]\n[omitted: private key]\n[omitted: private key]\nafter",
    );
    expect(result.omittedCount).toBe(5);
    expect(result.warnings.length).toBeGreaterThan(0);
    for (const secret of ["base64payload", "morepayload"])
      expect(JSON.stringify(result)).not.toContain(secret);
  });
});
