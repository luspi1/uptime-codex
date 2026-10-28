import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../features/auth/api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function freshApi() {
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${Math.random()}`);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function session(token) {
  return { user: { id: 1, email: "user@example.com", name: "" }, access_token: token, token_type: "Bearer", expires_in: 900 };
}

test("monitor creation retries after token expiry and list uses the same API contract", async () => {
  const originalFetch = globalThis.fetch;
  const input = { url: "https://example.com", interval_minutes: 5 };
  const item = { id: 1, ...input, created_at: "2026-10-26T12:00:00Z" };
  let creates = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/login")) return json(200, session("expired"));
    if (url.endsWith("/refresh")) return json(200, session("renewed"));
    assert.ok(url.endsWith("/api/monitors"));
    if (options.method === "POST") {
      creates += 1;
      assert.deepEqual(JSON.parse(options.body), input);
      if (creates === 1) return json(401, { error: { code: "invalid_token", message: "Expired" } });
      assert.equal(options.headers.Authorization, "Bearer renewed");
      return json(201, item);
    }
    assert.equal(options.headers.Authorization, "Bearer renewed");
    return json(200, [item]);
  };
  try {
    const api = await freshApi();
    await api.authenticate("login", "user@example.com", "password123");
    assert.deepEqual(await api.createMonitor(input), item);
    assert.deepEqual(await api.listMonitors(), [item]);
    assert.equal(creates, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("monitor API propagates validation errors and rejects invalid lists", async () => {
  const originalFetch = globalThis.fetch;
  let malformed = false;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/refresh")) return json(200, session("access"));
    if (malformed) return json(200, { monitors: [] });
    return json(400, { error: { code: "invalid_request", message: "Invalid URL" } });
  };
  try {
    const api = await freshApi();
    await assert.rejects(api.createMonitor({ url: "bad", interval_minutes: 5 }), { status: 400, code: "invalid_request" });
    malformed = true;
    await assert.rejects(api.listMonitors(), { code: "invalid_response" });
  } finally { globalThis.fetch = originalFetch; }
});

test("avatar upload preserves multipart body when access token expires", async () => {
  const originalFetch = globalThis.fetch;
  const avatar = new File(["png bytes"], "avatar.png", { type: "image/png" });
  const user = { id: 1, email: "user@example.com", name: "Анна", avatar_url: "/api/auth/avatars/test.png" };
  let uploads = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/login")) return json(200, session("expired"));
    if (url.endsWith("/refresh")) return json(200, session("renewed"));
    uploads += 1;
    assert.equal(options.method, "PATCH");
    assert.equal(options.headers["Content-Type"], undefined);
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("name"), "Анна");
    assert.equal(await options.body.get("avatar").text(), "png bytes");
    if (uploads === 1) return json(401, { error: { code: "invalid_token", message: "Expired" } });
    assert.equal(options.headers.Authorization, "Bearer renewed");
    return json(200, user);
  };
  try {
    const api = await freshApi();
    await api.authenticate("login", "user@example.com", "password123");
    assert.deepEqual(await api.updateProfile("Анна", avatar), user);
    assert.equal(uploads, 2);
    assert.ok(api.avatarSource(user.avatar_url).endsWith(user.avatar_url));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("profile update retries with renewed token and preserves PATCH body", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/login")) return json(200, session("expired"));
    if (url.endsWith("/refresh")) return json(200, session("renewed"));
    if (options.headers.Authorization === "Bearer expired") {
      return json(401, { error: { code: "invalid_token", message: "Expired" } });
    }
    assert.equal(options.method, "PATCH");
    assert.deepEqual(JSON.parse(options.body), { name: "Анна" });
    assert.equal(options.headers.Authorization, "Bearer renewed");
    return json(200, { id: 1, email: "user@example.com", name: "Анна" });
  };
  try {
    const api = await freshApi();
    await api.authenticate("login", "user@example.com", "password123");
    assert.deepEqual(await api.updateProfile("Анна"), { id: 1, email: "user@example.com", name: "Анна" });
    assert.deepEqual(calls.map(({ url }) => url.split("/").at(-1)), ["login", "me", "refresh", "me"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("registration stores access token only for Bearer requests and logout clears it", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/register")) {
      return json(201, session("access-1"));
    }
    if (url.endsWith("/me")) return json(200, { id: 1, email: "user@example.com", name: "" });
    if (url.endsWith("/logout")) return new Response(null, { status: 204 });
    return json(401, { error: { code: "invalid_token", message: "Invalid refresh token" } });
  };

  try {
    const api = await freshApi();
    assert.deepEqual(await api.authenticate("register", "user@example.com", "password123"), { id: 1, email: "user@example.com", name: "" });
    assert.deepEqual(await api.getCurrentUser(), { id: 1, email: "user@example.com", name: "" });
    await api.endSession();
    await assert.rejects(api.getCurrentUser(), { code: "invalid_token", status: 401 });
    assert.equal(calls[0].options.credentials, "include");
    assert.deepEqual(JSON.parse(calls[0].options.body), { email: "user@example.com", password: "password123" });
    assert.equal(calls[1].options.headers.Authorization, "Bearer access-1");
    assert.equal(calls[2].options.method, "POST");
    assert.equal(calls[3].options.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parallel refresh requests rotate the cookie once", async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith("/refresh"));
    assert.equal(options.credentials, "include");
    count += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return json(200, session("access-2"));
  };

  try {
    const api = await freshApi();
    const [first, second] = await Promise.all([api.refreshSession(), api.refreshSession()]);
    assert.deepEqual(first, second);
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expired access token is refreshed before retrying /me", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/login")) {
      return json(200, session("expired"));
    }
    if (url.endsWith("/refresh")) {
      return json(200, session("renewed"));
    }
    if (options.headers.Authorization === "Bearer expired") {
      return json(401, { error: { code: "invalid_token", message: "Invalid access token" } });
    }
    return json(200, { id: 1, email: "user@example.com", name: "" });
  };

  try {
    const api = await freshApi();
    await api.authenticate("login", "user@example.com", "password123");
    assert.deepEqual(await api.getCurrentUser(), { id: 1, email: "user@example.com", name: "" });
    assert.deepEqual(calls.map(({ url }) => url.split("/").at(-1)), ["login", "me", "refresh", "me"]);
    assert.equal(calls[3].options.headers.Authorization, "Bearer renewed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
