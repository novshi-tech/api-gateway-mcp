import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { publicUrl } from "../src/config";
import { buildServer } from "../src/mcp";
import { signToken, verifyToken } from "../src/tokens";
import { vaultFor } from "../src/vault";

const BASE = publicUrl(env);
const BOARD = { "x-api-key": "the-key", authorization: "board-token" };

// Durable Object storage persists across tests, so each test gets fresh users.
let alice: string, bob: string, carol: string, mallory: string;
beforeEach(() => {
  [alice, bob, carol, mallory] = Array.from({ length: 4 }, () => crypto.randomUUID());
});

async function addBoard(userId: string, label = "main") {
  const result = await vaultFor(env, userId).add("board", label, BOARD);
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
    expect(await vaultFor(env, alice).headers(cred.id)).toEqual({ "x-api-key": "the-key", authorization: "Bearer board-token" });
    expect(await vaultFor(env, bob).headers(cred.id)).toBeNull();
  });

  it("rejects unknown services and missing fields", async () => {
    expect(await vaultFor(env, alice).add("nope", "", {})).toEqual({ error: "unknown service: nope" });
    expect(await vaultFor(env, alice).add("board", "", { "x-api-key": "k" })).toEqual({ error: "missing value for authorization" });
  });

  it("removes credentials", async () => {
    const cred = await addBoard(alice);
    expect(await vaultFor(env, alice).remove(cred.id)).toBe(true);
    expect(await vaultFor(env, alice).list()).toEqual([]);
  });
});

describe("proxy", () => {
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
    expect(listed.services).toEqual(["board"]);
    expect(listed.credentials).toEqual([expect.objectContaining({ id: cred.id, service: "board" })]);
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
    expect(cred).toMatchObject({ service: "board", label: "form" });
    expect(await vaultFor(env, carol).headers(cred.id)).toEqual({ "x-api-key": "k", authorization: "Bearer t" });

    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie: await sessionCookie(carol) } })).text();
    expect(page).toContain(cred.id);
    expect(page).not.toContain(">k<");
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
