import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { publicUrl } from "../src/config";
import { buildServer } from "../src/mcp";
import { signToken } from "../src/tokens";
import { vaultFor } from "../src/vault";

const BASE = publicUrl(env);
const ORIGIN = new URL(BASE).origin;
const ACCOUNTS = "https://accounts.secure.freee.co.jp";

let alice: string, bob: string;
beforeEach(() => {
  [alice, bob] = Array.from({ length: 2 }, () => crypto.randomUUID());
});

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sessionCookie(userId: string) {
  const { token } = await signToken(env.SIGNING_KEY, BASE, "session", userId, { name: userId }, 60);
  return `__Host-gw-session=${token}`;
}

function cookieValue(res: Response, name: string): string {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!;
  return header.split(";")[0];
}

async function startConnect(userId: string, fields: Record<string, string>) {
  return SELF.fetch(`${BASE}/connect`, {
    method: "POST",
    headers: { cookie: await sessionCookie(userId), origin: ORIGIN },
    body: new URLSearchParams(fields),
    redirect: "manual",
  });
}

// Runs the whole connect flow against the fake freee and returns the callback response.
async function connect(userId: string, tokens: Tokens, fields: Record<string, string> = { service: "freee", label: "main" }) {
  const started = await startConnect(userId, fields);
  expect(started.status).toBe(303);
  const authorize = new URL(started.headers.get("location")!);
  const code = b64url({ challenge: authorize.searchParams.get("code_challenge"), tokens });
  return SELF.fetch(`${BASE}/connect/callback?code=${code}&state=${authorize.searchParams.get("state")}`, {
    headers: { cookie: `${await sessionCookie(userId)}; ${cookieValue(started, "__Host-gw-connect")}` },
    redirect: "manual",
  });
}

async function connected(userId: string, tokens: Tokens, service = "freee") {
  const res = await connect(userId, tokens, { service, label: "main" });
  expect(res.status).toBe(303);
  const credentials = await vaultFor(env, userId).list();
  return credentials[credentials.length - 1];
}

async function callFreee(userId: string, credentialId: string) {
  const { token } = await signToken(env.SIGNING_KEY, BASE, "api", userId, { creds: { freee: credentialId } }, 60);
  return SELF.fetch(`${BASE}/api/freee/api/1/companies`, { headers: { authorization: `Bearer ${token}` } });
}

async function upstreamAuthorization(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { headers: Record<string, string> }).headers.authorization;
}

async function refreshCalls(refreshToken: string): Promise<number> {
  return ((await (await fetch(`${ACCOUNTS}/stats?rt=${refreshToken}`)).json()) as { calls: number }).calls;
}

describe("connecting an OAuth service", () => {
  it("sends the user to the upstream with PKCE", async () => {
    const res = await startConnect(alice, { service: "freee", label: "" });
    expect(res.status).toBe(303);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe(`${ACCOUNTS}/public_api/authorize`);
    expect(url.searchParams.get("client_id")).toBe("freee-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/connect/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(cookieValue(res, "__Host-gw-connect")).not.toBe("__Host-gw-connect=");
  });

  it("stores the tokens and injects the access token", async () => {
    const cred = await connected(alice, { access_token: "first-access", refresh_token: "rt-a", expires_in: 21600 });
    expect(cred).toMatchObject({ service: "freee", label: "main" });
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer first-access");
    expect(await refreshCalls("rt-a")).toBe(0);

    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie: await sessionCookie(alice) } })).text();
    expect(page).toContain(cred.id);
    expect(page).not.toContain("first-access");
  });

  it("rejects a callback with the wrong state or another user's session", async () => {
    const started = await startConnect(alice, { service: "freee" });
    const state = new URL(started.headers.get("location")!).searchParams.get("state");
    const connectCookie = cookieValue(started, "__Host-gw-connect");

    const wrongState = await SELF.fetch(`${BASE}/connect/callback?code=x&state=other`, {
      headers: { cookie: `${await sessionCookie(alice)}; ${connectCookie}` },
    });
    expect(wrongState.status).toBe(400);
    const otherUser = await SELF.fetch(`${BASE}/connect/callback?code=x&state=${state}`, {
      headers: { cookie: `${await sessionCookie(bob)}; ${connectCookie}` },
    });
    expect(otherUser.status).toBe(400);
    expect(await vaultFor(env, alice).list()).toEqual([]);
    expect(await vaultFor(env, bob).list()).toEqual([]);
  });

  it("reports a failed token exchange", async () => {
    const started = await startConnect(alice, { service: "freee" });
    const state = new URL(started.headers.get("location")!).searchParams.get("state");
    const code = b64url({ challenge: "not-the-challenge", tokens: { access_token: "x" } });
    const res = await SELF.fetch(`${BASE}/connect/callback?code=${code}&state=${state}`, {
      headers: { cookie: `${await sessionCookie(alice)}; ${cookieValue(started, "__Host-gw-connect")}` },
    });
    expect(res.status).toBe(502);
    expect(await vaultFor(env, alice).list()).toEqual([]);
  });

  it("keeps OAuth and header services on their own forms", async () => {
    expect((await startConnect(alice, { service: "board" })).status).toBe(400);
    expect(await vaultFor(env, alice).add("freee", "", { authorization: "x" })).toEqual({ error: "freee is connected with OAuth" });
    expect((await startConnect(alice, { service: "freee", credential: crypto.randomUUID() })).status).toBe(400);
  });

  it("rejects cross-site connect requests", async () => {
    const res = await SELF.fetch(`${BASE}/connect`, {
      method: "POST",
      headers: { cookie: await sessionCookie(alice), origin: "https://evil.example" },
      body: new URLSearchParams({ service: "freee" }),
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });
});

describe("refreshing upstream tokens", () => {
  it("refreshes an expired access token and keeps the rotated refresh token", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "rt-b", expires_in: 0 });
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer access-after-rt-b");
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer access-after-rt-b");
    expect(await refreshCalls("rt-b")).toBe(1);
  });

  it("uses the rotated refresh token for the next refresh", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "short-c", expires_in: 0 });
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer access-after-short-c");
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer access-after-next-short-c");
    expect(await refreshCalls("short-c")).toBe(1);
    expect(await refreshCalls("next-short-c")).toBe(1);
  });

  it("runs one refresh for concurrent requests", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "rt-d", expires_in: 0 });
    const results = await Promise.all(Array.from({ length: 5 }, () => callFreee(alice, cred.id)));
    for (const res of results) expect(await upstreamAuthorization(res)).toBe("Bearer access-after-rt-d");
    expect(await refreshCalls("rt-d")).toBe(1);
  });

  it("asks for a reconnect when the refresh token is rejected", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "revoked-e", expires_in: 0 });
    const res = await callFreee(alice, cred.id);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("reconnected");
    expect(await vaultFor(env, alice).get(cred.id)).toMatchObject({ needsReconnect: true });

    // No more refresh attempts once the credential is marked.
    expect((await callFreee(alice, cred.id)).status).toBe(403);
    expect(await refreshCalls("revoked-e")).toBe(1);

    const server = buildServer(env, { userId: alice, name: alice });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientTransport);
    const issued = await client.callTool({ name: "issue_token", arguments: { credential_ids: [cred.id] } });
    expect(issued.isError).toBe(true);

    const page = await (await SELF.fetch(`${BASE}/`, { headers: { cookie: await sessionCookie(alice) } })).text();
    expect(page).toContain("再接続");
  });

  it("reconnects the same credential", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "revoked-f", expires_in: 0 });
    expect((await callFreee(alice, cred.id)).status).toBe(403);

    const res = await connect(alice, { access_token: "fresh", refresh_token: "rt-f", expires_in: 21600 }, { service: "freee", credential: cred.id });
    expect(res.status).toBe(303);
    const list = await vaultFor(env, alice).list();
    expect(list).toEqual([{ id: cred.id, service: "freee", label: "main", createdAt: cred.createdAt }]);
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer fresh");
  });

  it("returns 502 without asking for a reconnect when the upstream is down", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "down-g", expires_in: 0 });
    expect((await callFreee(alice, cred.id)).status).toBe(502);
    expect(await vaultFor(env, alice).get(cred.id)).not.toHaveProperty("needsReconnect");
  });

  it("sends the scopes again when refreshing a Graph token", async () => {
    const cred = await connected(alice, { access_token: "stale", refresh_token: "rt-graph", expires_in: 0 }, "graph");
    const { token } = await signToken(env.SIGNING_KEY, BASE, "api", alice, { creds: { graph: cred.id } }, 60);
    const res = await SELF.fetch(`${BASE}/api/graph/v1.0/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(await upstreamAuthorization(res)).toBe("Bearer access-after-rt-graph");
  });

  it("keeps using a token without an expiry", async () => {
    const cred = await connected(alice, { access_token: "forever" });
    expect(await upstreamAuthorization(await callFreee(alice, cred.id))).toBe("Bearer forever");
  });
});
