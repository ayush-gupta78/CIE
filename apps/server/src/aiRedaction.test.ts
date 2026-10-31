import { describe, expect, it } from "vitest";
import { redactEvidence } from "./aiRedaction.js";

describe("redactEvidence", () => {
  it("omits Makefile-style conditional credential assignments", () => {
    for (const operator of ["?=", "!="]) {
      const result = redactEvidence(
        `// PASSWORD ${operator} synthetic-make-secret\n`,
      );
      expect(result.text).not.toContain("synthetic-make-secret");
    }
  });
  it("screens compound credential assignments and omits ambiguous expressions", () => {
    for (const operator of [
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "**=",
      "&&=",
      "||=",
      "??=",
      "&=",
      "|=",
      "^=",
      "<<=",
      ">>=",
      ">>>=",
    ]) {
      for (const key of ["password", "config.apiKey", "config['token']"]) {
        for (const gap of ["", " ", " /* gap */ "]) {
          const input = `${key}${gap}${operator} "synthetic-compound-secret";\nconst safe = 1;`;
          expect(redactEvidence(input).text, input).not.toContain(
            "synthetic-compound-secret",
          );
        }
        const ambiguous = `${key} ${operator} make("synthetic-ambiguous-secret");\nconst safe = 1;`;
        const result = redactEvidence(ambiguous);
        expect(result.omittedCount, ambiguous).toBe(2);
        expect(result.text, ambiguous).not.toMatch(/synthetic-|const safe/);
      }
    }
    const safe =
      "password ||= process.env.PASSWORD;\nfunction login(password: string) {}";
    expect(redactEvidence(safe).text).toBe(safe);
  });
  it("fails closed for unresolved references and adjacent literal prefixes", () => {
    for (const input of [
      'const password = value; const value /* comment */ = "synthetic-comment-secret";',
      'password = r"synthetic-python-secret"',
      'password = b"synthetic-bytes-secret"',
      'password = f"synthetic-format-secret"',
      'password = u"synthetic-unicode-secret"',
      'password = mystery"synthetic-malformed-secret"',
      "const password = importedValue; // cross-file reference",
      'const password = string; const string = "synthetic-type-name-secret";',
      'const password = "safe" "synthetic-adjacent-secret";',
      'const password = "safe" /* gap */ "synthetic-adjacent-comment-secret";',
      'function login(password: string = "synthetic-default-secret") {}',
    ]) {
      const result = redactEvidence(input);
      expect(result.omittedCount, input).toBe(input.split("\n").length);
      expect(result.text, input).not.toContain("synthetic-");
    }
  });
  it("omits whole evidence for credential expressions", () => {
    for (const expression of [
      '("SYNTHSECRET")',
      '"SYNTHFIRST" + "SYNTHSECOND"',
      'process.env.SECRET ?? "SYNTHSECOND"',
      '!"SYNTHSECRET"',
      'flag ? "SYNTHFIRST" : "SYNTHSECOND"',
      '["SYNTHSECRET"][0]',
      'process.env.SECRET.slice("SYNTHSECRET")',
      "`SYNTHFIRST` + `SYNTHSECOND`",
      "`SYNTHFIRST${value}SYNTHSECOND`",
      '"SYNTHFIRST"\n + "SYNTHSECOND"',
    ]) {
      const input = `const password = ${expression};\nconst safe = 1;`;
      const result = redactEvidence(input);
      expect(result.text, expression).not.toMatch(/SYNTH|const safe/);
      expect(result.omittedCount, expression).toBe(input.split("\n").length);
      const objectInput = `const config = { password: ${expression}, safe: 1 };`;
      const objectResult = redactEvidence(objectInput);
      expect(objectResult.text, expression).not.toMatch(/SYNTH|safe: 1/);
      expect(objectResult.omittedCount, expression).toBe(
        objectInput.split("\n").length,
      );
    }
  });
  it("fails closed on indirect credentials and escaped continuations", () => {
    for (const input of [
      "shared: &cred syntheticAliasSecret\npassword: *cred",
      'const password = "partA\\\npartB";\nconst safe = 1;',
      "const password = \\\nsyntheticContinuationSecret",
      'shared: "syntheticCrossFieldSecret", password: shared',
      'const shared = "syntheticFunctionSecret"; const password = wrap(shared);',
      'const shared = "syntheticTemplateSecret"; const password = `${shared}`;',
    ]) {
      const result = redactEvidence(input);
      expect(result.text).not.toMatch(
        /syntheticAliasSecret|partA|partB|syntheticContinuationSecret|syntheticCrossFieldSecret|syntheticFunctionSecret|syntheticTemplateSecret/,
      );
      expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
    }
  });
  it("omits complete sensitive flow scalars with spaces", () => {
    const result = redactEvidence(
      "{password: LEAKVALUE with spaces, safe: ok}",
    );
    expect(result.text).not.toMatch(/LEAKVALUE|with spaces/);
  });
  it("screens JavaScript escaped credential names", () => {
    for (const input of [
      String.raw`{"api\x5fkey": "LEAKVALUE"}`,
      String.raw`{"api\u{5f}key": "LEAKVALUE"}`,
      String.raw`{"api\_key": "LEAKVALUE"}`,
    ]) {
      expect(redactEvidence(input).text).not.toContain("LEAKVALUE");
    }
  });
  it("masks values of malformed URL query names", () => {
    expect(
      redactEvidence("https://host/?token%ZZ=LEAKVALUE&safe=ok").text,
    ).not.toContain("LEAKVALUE");
  });
  it("bounds work on long hostile lines", () => {
    const start = performance.now();
    const result = redactEvidence("a".repeat(256 * 1024) + "!");
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.text).not.toContain("a".repeat(512));
  });
  it("omits ambiguous YAML credential scalars and their continuations", () => {
    for (const value of [
      "!str TAG_SECRET",
      "&anchor ANCHOR_SECRET",
      "!str &anchor COMBINED_SECRET",
      "!str # COMMENT_SECRET\n  NEXT_SECRET",
      '&anchor "FIRST_SECRET\nSECOND_SECRET"',
      "plain FIRST_SECRET SECOND_SECRET",
      "plain # COMMENT_SECRET",
      "!str [FIRST_SECRET, SECOND_SECRET]",
    ]) {
      const input = `password: ${value}\nsafe: visible`;
      const result = redactEvidence(input);
      expect(result.text).not.toMatch(
        /(?:TAG|ANCHOR|COMBINED|COMMENT|NEXT|FIRST|SECOND)_SECRET/,
      );
      expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
    }
  });
  it("does not transmit multiline quoted or malformed indented credential values", () => {
    for (const input of [
      'password: "first\nSECOND_SYNTHETIC\nthird"\nsafe: visible',
      "password: null\n  ORPHAN_SYNTHETIC\nsafe: visible",
    ]) {
      const result = redactEvidence(input);
      expect(result.text).not.toMatch(/SECOND_SYNTHETIC|ORPHAN_SYNTHETIC/);
      expect(result.text).toContain("safe: visible");
      expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
    }
  });
  it("fails closed on computed names, comment gaps and multiline values", () => {
    const cases = [
      "const x = { ['apiKey']: 'synthetic-computed', safe: 1 };",
      "const x = { [dynamicName]: { value: 'synthetic-dynamic' }, safe: 1 };",
      "const x = { [obj[key]]: 'synthetic-nested-key' };",
      "const x = { apiKey /* synthetic-gap-secret */ : 'synthetic-gap-value' };",
      "const x = { [dynamicName]: make('synthetic-call', 'synthetic-argument') };",
      "const token = `synthetic-template ${`synthetic-inner`} synthetic-tail`;",
      "const x = { apiKey /* gap */ : 'synthetic-comment', safe: 1 };",
      "password: |\n  synthetic-yaml\n  second-yaml\nsafe: visible",
      "const token = `synthetic-template\nsecond-template`;\nconst safe = 1;",
      "const x = { [dynamicName: 'synthetic-malformed\nsynthetic-tail",
      `password: ${"[".repeat(20000)}synthetic-deep${"]".repeat(20000)}`,
    ];
    for (const input of cases) {
      const result = redactEvidence(input);
      expect(result.text).not.toMatch(/synthetic-|second-yaml|second-template/);
      expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
    }
    expect(redactEvidence(cases[7]).text).toContain("safe: visible");
    expect(redactEvidence(cases[8]).text).toContain("const safe = 1;");
  });
  it("screens multiline structured values, escaped names and Basic credentials", () => {
    const input = [
      String.raw`{ "api\u005fkey":`,
      '  "first-secret",',
      "  password: { nested: ['second-secret', {value: 'third-secret'}] },",
      String.raw`  pass\u0077ord: 'fourth-secret',`,
      "  authorization: 'Basic dXNlcjpwYXNz',",
      "  safe: 'visible' }",
      "const token = process.env.TOKEN;",
      "function validateToken(token: string) { return token; }",
    ].join("\n");
    const result = redactEvidence(input);
    for (const secret of [
      "first-secret",
      "second-secret",
      "third-secret",
      "fourth-secret",
      "dXNlcjpwYXNz",
    ])
      expect(result.text).not.toContain(secret);
    expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
    expect(result.text).toContain("safe: 'visible'");
    expect(result.text).toContain("const token = process.env.TOKEN;");
    expect(result.text).toContain(
      "function validateToken(token: string) { return token; }",
    );
  });
  it("omits an unterminated scalar and same-line comment gap", () => {
    const input =
      "password: /* gap-secret */ 'value-secret'\ntoken: 'unclosed-secret\nleaked-tail";
    const result = redactEvidence(input);
    for (const secret of [
      "gap-secret",
      "value-secret",
      "unclosed-secret",
      "leaked-tail",
    ])
      expect(result.text).not.toContain(secret);
    expect(result.text.split("\n")).toHaveLength(3);
  });
  it("fails closed for credential containers, comments and unterminated values", () => {
    const input = [
      "apiKeys: /* hidden-comment */ [",
      "  'plural-secret', { nested: 'nested-secret' }",
      "],",
      String.raw`'pass\u0077ord': 'single-secret',`,
      "credentials:",
      "  { value: 'unclosed-secret'",
      "leaked_tail",
    ].join("\n");
    const result = redactEvidence(input);
    for (const secret of [
      "hidden-comment",
      "plural-secret",
      "nested-secret",
      "single-secret",
      "unclosed-secret",
      "leaked_tail",
    ])
      expect(result.text).not.toContain(secret);
    expect(result.text.split("\n")).toHaveLength(input.split("\n").length);
  });
  it("masks JSON values under escaped credential names without changing other source text", () => {
    const input = String.raw`{"api\u005fkey":"top-secret-123","access\u0054oken":"other secret","pass\u0077ord":"third","safe\u005fname":"visible","odd\"api\u005fkey":"fourth"}`;
    const result = redactEvidence(input);
    expect(result.text).toBe(
      String.raw`{"api\u005fkey":"[redacted]","access\u0054oken":"[redacted]","pass\u0077ord":"[redacted]","safe\u005fname":"visible","odd\"api\u005fkey":"[redacted]"}`,
    );
    expect(result.redactedCount).toBe(4);
  });
  it("masks numeric JSON credentials with escaped names", () => {
    const input = String.raw`{"api\u005fkey":123456,"safe":42}`;
    expect(redactEvidence(input).text).toBe(
      String.raw`{"api\u005fkey":"[redacted]","safe":42}`,
    );
  });
  it("masks percent-encoded credential query names", () => {
    const result = redactEvidence(
      "https://host/?%74oken=hidden-value&safe=ok&api%5Fkey=another-value",
    );
    expect(result.text).not.toContain("hidden-value");
    expect(result.text).not.toContain("another-value");
    expect(result.text).toContain("safe=ok");
  });
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
    const input = `const password = 'hidden password'; // check login\napi_key: "private-key"\nSECRET='opaque'\nconst token = "sk-verylongprivate123";`;
    const result = redactEvidence(input);
    expect(result.text).toBe(
      `const password = '[redacted]'; // check login\napi_key: "[redacted]"\nSECRET='[redacted]'\nconst token = "[redacted]";`,
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
