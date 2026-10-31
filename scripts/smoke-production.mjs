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
      stdio: "ignore",
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
  assert.match(await html.text(), /<div id="root"><\/div>/);
  const selection = await fetch(`${url}/api/v1/repository`);
  assert.deepEqual(await selection.json(), { selected: false });
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
