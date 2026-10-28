import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { createLocalJWKSet, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { handleProxy } from "../src/proxy";
import { publicUrl } from "../src/config";
import { buildServer } from "../src/mcp";
import { getUpstream } from "../src/services";
import { signToken, verifyToken } from "../src/tokens";
import { vaultFor } from "../src/vault";
import { upstream } from "./helpers";

const BASE = publicUrl(env);
const BOARD = { "x-api-key": "the-key", authorization: "board-token" };

// Durable Object storage persists across tests, so each test gets fresh users.
let alice: string, bob: string, carol: string, mallory: string;
beforeEach(() => {
  [alice, bob, carol, mallory] = Array.from({ length: 4 }, () => crypto.randomUUID());
});

async function addBoard(userId: string, label = "main") {
  const result = await vaultFor(env, userId).add(await upstream("board"), label, BOARD);
  if ("error" in result) throw new Error(result.error);
  return result;
}

async function apiToken(userId: string, creds: Record<string, string>, ttl = 60) {
  return (await signToken(env.SIGNING_KEY, BASE, "api", userId, { creds }, ttl)).token;
}

describe("vault", () => {
  it("stores credentials per user and builds headers from the service config", async () => {
    const cred = await addBoard(alice);
    expect(await vaultFor(env, alice).list()).toEqual([expect.objectContaining({ id: cred.id, service: "board", label: "main" })]);
    expect(await vaultFor(env, bob).list()).toEqual([]);
    expect(await vaultFor(env, alice).headers(cred.id, await upstream("board"))).toEqual({ headers: { "x-api-key": "the-key", authorization: "Bearer board-token" } });
    expect(await vaultFor(env, bob).headers(cred.id, await upstream("board"))).toEqual({ error: "missing" });
    expect(await vaultFor(env, alice).headers(cred.id, await upstream("serper"))).toEqual({ error: "missing" });
  });

  it("rejects unknown services and missing fields", async () => {
    expect(await getUpstream(env, "nope")).toBeNull();
    expect(await getUpstream(env, "constructor")).toBeNull();
    expect(await vaultFor(env, alice).add(await upstream("board"), "", { "x-api-key": "k" })).toEqual({ error: "missing value for authorization" });
  });

  it("sends secrets only to the upstream they were entered for", async () => {
    const cred = await addBoard(alice);
    const board = await upstream("board");
    const samePlace = { ...board, config: { ...board.config, base_url: "https://api.the-board.jp/v2" } };
    expect(await vaultFor(env, alice).headers(cred.id, samePlace)).toHaveProperty("headers");

    const elsewhere = { ...board, config: { ...board.config, base_url: "https://evil.example" } };
    expect(await vaultFor(env, alice).headers(cred.id, elsewhere)).toEqual({ error: "reconnect" });
    expect(await vaultFor(env, alice).get(cred.id)).toMatchObject({ needsReconnect: true });
    // Moving the definition back does not undo it: the user re-enters the key.
    expect(await vaultFor(env, alice).headers(cred.id, board)).toEqual({ error: "reconnect" });
  });

  it("ties an OAuth credential to its token endpoint and client", async () => {
    const freee = await upstream("freee");
    const tokens = { access_token: "a", refresh_token: "r", expires_at: Date.now() + 3_600_000 };
    const first = await vaultFor(env, alice).addOAuth(freee, "main", tokens);
    const second = await vaultFor(env, alice).addOAuth(freee, "other", tokens);
    if ("error" in first || "error" in second) throw new Error("not stored");
    expect(await vaultFor(env, alice).headers(first.id, freee)).toEqual({ headers: { authorization: "Bearer a" } });
    const newClient = { ...freee, client: { id: "another-client", secret: "s" } };
    expect(await vaultFor(env, alice).headers(first.id, newClient)).toEqual({ error: "reconnect" });
    const auth = freee.config.auth as { token_url: string };
    const newTokenUrl = { ...freee, config: { ...freee.config, auth: { ...auth, token_url: "https://evil.example/token" } } };
    expect(await vaultFor(env, alice).headers(second.id, newTokenUrl as typeof freee)).toEqual({ error: "reconnect" });
  });

  it("records the upstream of an older credential on first use", async () => {
    const cred = await addBoard(alice);
    const stub = vaultFor(env, alice);
    await runInDurableObject(stub, async (_, state) => {
      const stored = (await state.storage.get<Record<string, unknown>>(`cred:${cred.id}`))!;
      delete stored.target;
      await state.storage.put(`cred:${cred.id}`, stored);
    });
    expect(await stub.headers(cred.id, await upstream("board"))).toHaveProperty("headers");
    const target = await runInDurableObject(stub, async (_, state) => (await state.storage.get<{ target?: string }>(`cred:${cred.id}`))!.target);
    expect(target).toBe("https://api.the-board.jp");
  });

  it("removes credentials", async () => {
    const cred = await addBoard(alice);
    expect(await vaultFor(env, alice).remove(cred.id)).toBe(true);
    expect(await vaultFor(env, alice).list()).toEqual([]);
  });
});

describe("proxy", () => {
  it("sends the gBizINFO API token in its own header", async () => {
    const cred = await vaultFor(env, alice).add(await upstream("gbizinfo"), "main", { "x-hojininfo-api-token": "gbiz-token" });
    expect("error" in cred).toBe(false);
    const id = (cred as { id: string }).id;
    const res = await SELF.fetch(`${BASE}/api/gbizinfo/hojin/v2/hojin?name=%E3%83%86%E3%82%B9%E3%83%88`, {
      headers: { authorization: `Bearer ${await apiToken(alice, { gbizinfo: id })}` },
    });
    expect(res.status).toBe(200);
    const echoed = (await res.json()) as { url: string; headers: Record<string, string> };
    expect(echoed.url).toBe("https://api.info.gbiz.go.jp/hojin/v2/hojin?name=%E3%83%86%E3%82%B9%E3%83%88");
    expect(echoed.headers["x-hojininfo-api-token"]).toBe("gbiz-token");
    expect(echoed.headers.authorization).toBeUndefined();
  });

  it("sends the Serper API key in its own header", async () => {
    const cred = await vaultFor(env, alice).add(await upstream("serper"), "main", { "x-api-key": "serper-key" });
    expect("error" in cred).toBe(false);
    const id = (cred as { id: string }).id;
    const res = await SELF.fetch(`${BASE}/api/serper/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${await apiToken(alice, { serper: id })}`, "content-type": "application/json" },
      body: JSON.stringify({ q: "test", gl: "jp", hl: "ja" }),
    });
    expect(res.status).toBe(200);
    const echoed = (await res.json()) as { url: string; headers: Record<string, string> };
    expect(echoed.url).toBe("https://google.serper.dev/search");
    expect(echoed.headers["x-api-key"]).toBe("serper-key");
    expect(echoed.headers.authorization).toBeUndefined();
  });

  it("forwards to the upstream with injected credentials", async () => {
    const cred = await addBoard(alice);
    const res = await SELF.fetch(`${BASE}/api/board/v1/clients?page=2`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await apiToken(alice, { board: cred.id })}`,
        cookie: "session=secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-upstream")).toBe("yes");
    const echoed = (await res.json()) as { method: string; url: string; headers: Record<string, string>; body: string };
    expect(echoed.method).toBe("POST");
    expect(echoed.url).toBe("https://api.the-board.jp/v1/clients?page=2");
    expect(echoed.headers["x-api-key"]).toBe("the-key");
    expect(echoed.headers.authorization).toBe("Bearer board-token");
    expect(echoed.headers.cookie).toBeUndefined();
    expect(echoed.body).toBe('{"name":"x"}');
  });

  it("passes binary bodies through untouched", async () => {
    const cred = await addBoard(alice);
    const bytes = new Uint8Array(256).map((_, i) => i);
    const res = await SELF.fetch(`${BASE}/api/board/binary`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await apiToken(alice, { board: cred.id })}` },
      body: bytes,
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("returns upstream redirects to the caller", async () => {
    const cred = await addBoard(alice);
    const res = await SELF.fetch(`${BASE}/api/board/redirect`, {
      headers: { authorization: `Bearer ${await apiToken(alice, { board: cred.id })}` },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://download.example.com/file");
  });

  it("requires a valid gateway token", async () => {
    expect((await SELF.fetch(`${BASE}/api/board/v1/clients`)).status).toBe(401);
    const expired = await apiToken(alice, { board: "x" }, -1);
    const res = await SELF.fetch(`${BASE}/api/board/v1/clients`, { headers: { authorization: `Bearer ${expired}` } });
    expect(res.status).toBe(401);
  });

  it("refuses services the token does not cover", async () => {
    const res = await SELF.fetch(`${BASE}/api/board/v1/clients`, {
      headers: { authorization: `Bearer ${await apiToken(alice, {})}` },
    });
    expect(res.status).toBe(403);
  });

  it("refuses unknown services", async () => {
    const res = await SELF.fetch(`${BASE}/api/nope/x`, {
      headers: { authorization: `Bearer ${await apiToken(alice, { nope: "x" })}` },
    });
    expect(res.status).toBe(404);
  });

  it("never uses another user's credential", async () => {
    const cred = await addBoard(alice);
    const res = await SELF.fetch(`${BASE}/api/board/v1/clients`, {
      headers: { authorization: `Bearer ${await apiToken(mallory, { board: cred.id })}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("identity upstreams", () => {
  async function verifyIdentity(token: string) {
    const keys = (await (await SELF.fetch(`${BASE}/.well-known/jwks.json`)).json()) as { keys: never[] };
    return jwtVerify(token, createLocalJWKSet(keys), { issuer: BASE, audience: "murmur", algorithms: ["EdDSA"] });
  }

  it("publishes only the public half of the identity key", async () => {
    const res = await SELF.fetch(`${BASE}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    const { keys } = (await res.json()) as { keys: Record<string, string>[] };
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", alg: "EdDSA", use: "sig" });
    expect(keys[0].kid).toBeTruthy();
    expect(keys[0].d).toBeUndefined();
  });

  it("replaces the caller's authorization with the user's signed identity", async () => {
    const res = await SELF.fetch(`${BASE}/api/murmur/tasks?filter=open`, {
      headers: { authorization: `Bearer ${await apiToken(alice, { murmur: "identity" })}`, "x-murmur-identity": "forged" },
    });
    expect(res.status).toBe(200);
    const echoed = (await res.json()) as { url: string; headers: Record<string, string> };
    expect(echoed.url).toBe("https://murmur.example/api/tasks?filter=open");
    const token = echoed.headers.authorization.replace(/^Bearer /, "");
    const { payload, protectedHeader } = await verifyIdentity(token);
    expect(payload.sub).toBe(alice);
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(protectedHeader).toMatchObject({ alg: "EdDSA", typ: "JWT" });
  });

  it("refuses a token whose credential for the service is not the identity", async () => {
    const cred = await addBoard(alice);
    const res = await SELF.fetch(`${BASE}/api/murmur/tasks`, {
      headers: { authorization: `Bearer ${await apiToken(alice, { murmur: cred.id })}` },
    });
    expect(res.status).toBe(403);
    const none = await SELF.fetch(`${BASE}/api/murmur/tasks`, { headers: { authorization: `Bearer ${await apiToken(alice, {})}` } });
    expect(none.status).toBe(403);
  });

  it("reaches the upstream through its Service Binding when one is configured", async () => {
    const seen: Request[] = [];
    const bound = {
      ...env,
      SERVICES: { murmur: { base_url: "https://murmur.internal/api", binding: "MURMUR", auth: { type: "identity", audience: "murmur" } } },
      MURMUR: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          seen.push(new Request(input, init));
          return Response.json({ ok: true });
        },
      },
    } as unknown as Env;
    const res = await handleProxy(
      new Request(`${BASE}/api/murmur/me`, { headers: { authorization: `Bearer ${await apiToken(bob, { murmur: "identity" })}` } }),
      bound,
    );
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://murmur.internal/api/me");
    const { payload } = await verifyIdentity(seen[0].headers.get("authorization")!.replace(/^Bearer /, ""));
    expect(payload.sub).toBe(bob);
  });

  it("does not store credentials for identity services", async () => {
    expect(await vaultFor(env, alice).add(await upstream("murmur"), "", {})).toEqual({ error: "murmur needs no credential" });
  });
});

describe("mcp tools", () => {
  async function connect(userId: string) {
    const server = buildServer(env, { userId, name: userId });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    return client;
  }

  function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
    return (result.content as { type: string; text: string }[])[0].text;
  }

  it("lists the user's credentials", async () => {
    const cred = await addBoard(alice);
    const client = await connect(alice);
    const listed = JSON.parse(text(await client.callTool({ name: "list_credentials", arguments: {} })));
    // "unclient" has no OAuth client in the tests, so it is not offered.
    expect(listed.services).toEqual(["freee", "gmail", "drive", "calendar", "docs", "analytics", "analytics-admin", "board", "gbizinfo", "serper", "graph", "murmur"]);
    expect(listed.credentials).toEqual([
      expect.objectContaining({ id: cred.id, service: "board" }),
      { id: "identity:murmur", service: "murmur", label: "Murmur(サインイン中のユーザー)" },
    ]);
  });

  it("issues a token that the proxy accepts", async () => {
    const cred = await addBoard(alice);
    const client = await connect(alice);
    const issued = JSON.parse(text(await client.callTool({ name: "issue_token", arguments: { credential_ids: [cred.id] } })));
    expect(issued.base_url).toBe(`${BASE}/api`);
    const claims = await verifyToken<{ creds: Record<string, string> }>(env.SIGNING_KEY, BASE, "api", issued.token);
    expect(claims).toMatchObject({ sub: alice, creds: { board: cred.id } });

    const res = await SELF.fetch(`${issued.services.board}/v1/clients`, { headers: { authorization: `Bearer ${issued.token}` } });
    expect(res.status).toBe(200);
  });

  it("marks every tool read-only so clients do not ask before each call", async () => {
    const client = await connect(alice);
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("issues a token for an identity service without a stored credential", async () => {
    const cred = await addBoard(alice);
    const client = await connect(alice);
    const issued = JSON.parse(
      text(await client.callTool({ name: "issue_token", arguments: { credential_ids: ["identity:murmur", cred.id] } })),
    );
    const claims = await verifyToken<{ creds: Record<string, string> }>(env.SIGNING_KEY, BASE, "api", issued.token);
    expect(claims?.creds).toEqual({ murmur: "identity", board: cred.id });
    const res = await SELF.fetch(`${issued.services.murmur}/me`, { headers: { authorization: `Bearer ${issued.token}` } });
    expect(res.status).toBe(200);

    const notIdentity = await client.callTool({ name: "issue_token", arguments: { credential_ids: ["identity:board"] } });
    expect(notIdentity.isError).toBe(true);
    const unknown = await client.callTool({ name: "issue_token", arguments: { credential_ids: ["identity:nope"] } });
    expect(unknown.isError).toBe(true);
  });

  it("refuses other users' credentials and duplicate services", async () => {
    const mine = await addBoard(alice, "a");
    const second = await addBoard(alice, "b");
    const theirs = await addBoard(bob);
    const client = await connect(alice);

    const foreign = await client.callTool({ name: "issue_token", arguments: { credential_ids: [theirs.id] } });
    expect(foreign.isError).toBe(true);
    const duplicate = await client.callTool({ name: "issue_token", arguments: { credential_ids: [mine.id, second.id] } });
    expect(duplicate.isError).toBe(true);
  });
});

describe("oauth surface", () => {
  it("challenges unauthenticated MCP requests with resource metadata", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  });

  it("publishes protected resource and authorization server metadata", async () => {
    const prm = (await (await SELF.fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(prm.resource).toBe(`${BASE}/mcp`);
    expect(prm.authorization_servers).toEqual([BASE]);

    const as = (await (await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(as.issuer).toBe(BASE);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`);
  });
});

describe("web ui", () => {
  async function sessionCookie(userId: string) {
    const { token } = await signToken(env.SIGNING_KEY, BASE, "session", userId, { name: userId }, 60);
    return `__Host-gw-session=${token}`;
  }

  it("redirects to sign-in without a session", async () => {
    const res = await SELF.fetch(`${BASE}/`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("registers a credential from the form", async () => {
    const body = new URLSearchParams({ service: "board", label: "form", "h:x-api-key": "k", "h:authorization": "t" });
    const res = await SELF.fetch(`${BASE}/credentials`, {
      method: "POST",
      headers: { cookie: await sessionCookie(carol), origin: new URL(BASE).origin },
      body,
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    const [cred] = await vaultFor(env, carol).list();
    expect(res.headers.get("location")).toBe(`/?added=${cred.id}`);
    expect(cred).toMatchObject({ service: "board", label: "form" });
    expect(await vaultFor(env, carol).headers(cred.id, await upstream("board"))).toEqual({ headers: { "x-api-key": "k", authorization: "Bearer t" } });

    const page = await (await SELF.fetch(`${BASE}/?added=${cred.id}`, { headers: { cookie: await sessionCookie(carol) } })).text();
    expect(page).toContain(cred.id);
    expect(page).not.toContain(">k<");
    expect(page).toContain("「form」をつなぎました");
  });

  it("lists connections and identity services on the home page", async () => {
    const cookie = await sessionCookie(carol);
    const empty = await (await SELF.fetch(`${BASE}/`, { headers: { cookie } })).text();
    expect(empty).toContain("Murmur");
    expect(empty).toContain("登録不要");
    expect(empty).toContain(`href="/connections/new"`);

    const cred = await addBoard(carol, "main");
    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie } })).text();
    expect(page).toContain(`href="/connections/${cred.id}/delete"`);
  });

  it("offers services grouped by provider, without identity services or OAuth services lacking a client", async () => {
    const page = await (await SELF.fetch(`${BASE}/connections/new`, { headers: { cookie: await sessionCookie(carol) } })).text();
    const order = ["<h2>Google</h2>", "<h2>Microsoft</h2>", "<h2>freee</h2>", "<h2>その他</h2>"].map((h) => page.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page).toContain(`href="/connections/new/docs"`);
    expect(page).toContain(`href="/connections/new/board"`);
    expect(page).toContain(`href="/connections/new/gmail"`);
    expect(page).not.toContain(`href="/connections/new/unclient"`);
    expect(page).not.toContain(`href="/connections/new/murmur"`);
    expect(page).toContain(`<script src="/assets/app.js" defer></script>`);
  });

  it("shows a form for one service and 404 for others", async () => {
    const cookie = await sessionCookie(carol);
    const board = await SELF.fetch(`${BASE}/connections/new/board`, { headers: { cookie } });
    expect(board.status).toBe(200);
    const form = await board.text();
    expect(form).toContain(`action="/credentials"`);
    expect(form).toContain(`name="h:x-api-key"`);
    expect(await (await SELF.fetch(`${BASE}/connections/new/freee`, { headers: { cookie } })).text()).toContain(`action="/connect"`);
    expect((await SELF.fetch(`${BASE}/connections/new/murmur`, { headers: { cookie } })).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/connections/new/unclient`, { headers: { cookie } })).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/connections/new/constructor`, { headers: { cookie } })).status).toBe(404);
  });

  it("confirms before deleting a connection", async () => {
    const cookie = await sessionCookie(carol);
    const cred = await addBoard(carol, "to-delete");
    const confirm = await (await SELF.fetch(`${BASE}/connections/${cred.id}/delete`, { headers: { cookie } })).text();
    expect(confirm).toContain("「to-delete」を削除しますか?");
    expect(confirm).toContain(`action="/credentials/${cred.id}/delete"`);
    expect(await vaultFor(env, carol).list()).toHaveLength(1);

    const res = await SELF.fetch(`${BASE}/credentials/${cred.id}/delete`, {
      method: "POST",
      headers: { cookie, origin: new URL(BASE).origin },
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe("/?deleted=1");
    expect(await vaultFor(env, carol).list()).toEqual([]);
    const gone = await SELF.fetch(`${BASE}/connections/${cred.id}/delete`, { headers: { cookie }, redirect: "manual" });
    expect(gone.headers.get("location")).toBe("/");
  });

  it("serves the picker script and lets pages load it", async () => {
    const js = await SELF.fetch(`${BASE}/assets/app.js`);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toContain("data-search");
    const page = await SELF.fetch(`${BASE}/connections/new`, { headers: { cookie: await sessionCookie(carol) } });
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("shows the user ID for the admin setting", async () => {
    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie: await sessionCookie(carol) } })).text();
    expect(page).toMatch(new RegExp(`<details class="account"><summary>アカウントの情報</summary><p>ユーザー ID: <code>${carol}</code>`));
  });

  it("asks to delete and add again when an API key no longer fits its service", async () => {
    const cred = await addBoard(carol);
    const board = await upstream("board");
    await vaultFor(env, carol).headers(cred.id, { ...board, config: { ...board.config, base_url: "https://moved.example" } });
    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie: await sessionCookie(carol) } })).text();
    expect(page).toContain("削除して追加し直してください");
    expect(page).not.toContain(`name="credential" value="${cred.id}"`);
  });

  it("escapes what the user typed when showing it back", async () => {
    await addBoard(carol, `<script>alert("x")</script>`);
    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie: await sessionCookie(carol) } })).text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;");
  });

  it("signs out without starting a new sign-in", async () => {
    const res = await SELF.fetch(`${BASE}/logout`, {
      method: "POST",
      headers: { cookie: await sessionCookie(carol), origin: new URL(BASE).origin },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-gw-session=; .*Max-Age=0/);
  });

  it("rejects cross-site form posts", async () => {
    const res = await SELF.fetch(`${BASE}/credentials`, {
      method: "POST",
      headers: { cookie: await sessionCookie(carol), origin: "https://evil.example" },
      body: new URLSearchParams({ service: "board" }),
    });
    expect(res.status).toBe(403);
    expect(await vaultFor(env, carol).list()).toEqual([]);
  });
});
