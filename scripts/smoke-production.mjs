import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { request } from "node:http";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const launch = () => {
  const child = spawn(
    process.execPath,
    ["apps/server/dist/main.js", "--production"],
    {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  return child;
};
const exited = (child) =>
  new Promise((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
const url = "http://127.0.0.1:3001";
const rawStatus = (headers, method = "GET") =>
  new Promise((done, reject) => {
    const call = request(url, { headers, method }, (response) => {
      response.resume();
      done(response.statusCode);
    });
    call.on("error", reject);
    call.end();
  });
let first;
try {
  first = launch();
  let terminalOutput = "";
  first.stderr.on("data", (chunk) => {
    terminalOutput = (terminalOutput + String(chunk)).slice(-4096);
  });
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (first.exitCode !== null)
      throw new Error(`production server exited: ${first.exitCode}`);
    try {
      const response = await fetch(`${url}/api/v1/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      /* startup in progress */
    }
    await delay(100);
  }
  assert.ok(healthy, "production API did not start");
  const html = await fetch(url);
  assert.equal(html.status, 200);
  const markup = await html.text();
  assert.match(markup, /<div id="root"><\/div>/);
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(markup)?.[1];
  assert.ok(asset, "built script missing");
  assert.ok((await fetch(url + asset)).headers.get("content-security-policy"));
  const selection = await fetch(`${url}/api/v1/repository`);
  assert.equal(selection.status, 401);
  assert.equal((await fetch(`${url}/%61pi/v1/repository`)).status, 401);
  assert.equal(
    (
      await fetch(`${url}/api/%76%31/repository/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      })
    ).status,
    401,
  );
  const secret =
    /CIE pairing secret \(enter in the local browser; do not share\): ([A-Za-z0-9_-]+)/.exec(
      terminalOutput,
    )?.[1];
  assert.ok(secret, "terminal pairing channel missing");
  assert.ok(!markup.includes(secret));
  assert.ok(!(await selection.text()).includes(secret));
  const paired = await fetch(`${url}/api/v1/auth/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret }),
  });
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.ok(!cookie.includes("Secure") && !cookie.includes("Domain="));
  const csrf = (await paired.json()).csrf;
  const authenticated = { Cookie: cookie.split(";", 1)[0] };
  assert.equal(
    (
      await fetch(`${url}/api/%76%31/repository/select`, {
        method: "POST",
        headers: { ...authenticated, "Content-Type": "application/json" },
        body: JSON.stringify({ path: root }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${url}/api/v1/repository`, { headers: authenticated }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(`${url}/api/v1/repository/rescan`, {
        method: "POST",
        headers: { ...authenticated, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${url}/api/v1/nonexistent`, { headers: authenticated }))
      .status,
    404,
  );
  assert.equal(
    (
      await fetch(`${url}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          ...authenticated,
          "Content-Type": "application/json",
          "X-CIE-CSRF": csrf,
        },
        body: "{}",
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${url}/api/v1/repository`, { headers: authenticated }))
      .status,
    401,
  );
  terminalOutput = "";
  for (const header of [
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
  ])
    assert.ok(html.headers.get(header), `missing ${header}`);
  assert.equal(await rawStatus({ Host: "evil.test" }), 403);
  assert.equal(
    await rawStatus({ Host: "127.0.0.1:3001", Origin: "http://evil.test" }),
    403,
  );
  assert.equal(
    await rawStatus(
      { Host: "127.0.0.1:3001", "Content-Type": "text/plain" },
      "POST",
    ),
    415,
  );
  assert.equal((await fetch(`${url}/api/v1/nonexistent`)).status, 404);
  assert.equal((await fetch(`${url}/missing.js`)).status, 404);
  const second = launch();
  try {
    const result = await Promise.race([
      exited(second),
      delay(5000).then(() => {
        throw new Error("occupied port did not fail");
      }),
    ]);
    assert.equal(
      result.code,
      1,
      "occupied port must fail without switching port",
    );
  } finally {
    if (second.exitCode === null) second.kill("SIGTERM");
  }
  const stopped = exited(first);
  first.kill("SIGTERM");
  assert.deepEqual(
    await Promise.race([
      stopped,
      delay(5000).then(() => {
        throw new Error("shutdown timeout");
      }),
    ]),
    { code: 0, signal: null },
  );
  first = undefined;
  await assert.rejects(
    fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(1000) }),
  );
  console.log(
    "Production smoke passed: same-origin assets/API, gate, missing assets, occupied port, shutdown.",
  );
} finally {
  if (first && first.exitCode === null) first.kill("SIGTERM");
}
