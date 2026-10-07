import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { defineConfig } from "vitest/config";
import { experimental_readRawConfig } from "wrangler";

const CONFIG = "./wrangler.example.jsonc";
// The example's services, plus "board" for tests of a service that takes two
// headers, one with a prefix. Board itself is no longer in the example.
const SERVICES = {
  board: {
    base_url: "https://api.the-board.jp",
    auth: {
      type: "headers",
      headers: [
        { name: "x-api-key", label: "API キー" },
        { name: "authorization", label: "API トークン", prefix: "Bearer " },
      ],
    },
  },
  ...(experimental_readRawConfig({ config: CONFIG }).rawConfig.vars?.SERVICES as object),
};

const IDP = "https://idp.test";
const OIDC_ISSUER = `${IDP}/tenant/v2.0`;
const OIDC_CLIENT_ID = "test-client";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };

// A fake OpenID provider. The authorization code is base64url JSON of the
// claims the test wants in the ID token, so tests choose who signs in.
async function idp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/tenant/v2.0/.well-known/openid-configuration") {
    return Response.json({
      issuer: OIDC_ISSUER,
      authorization_endpoint: `${IDP}/authorize`,
      token_endpoint: `${IDP}/token`,
      jwks_uri: `${IDP}/jwks`,
    });
  }
  if (url.pathname === "/jwks") return Response.json({ keys: [jwk] });
  if (url.pathname === "/token" && request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    if (form.get("client_id") !== OIDC_CLIENT_ID || !form.get("code_verifier")) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const claims = JSON.parse(Buffer.from(form.get("code")!, "base64url").toString());
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(OIDC_ISSUER)
      .setAudience(OIDC_CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return Response.json({ access_token: "idp-access", token_type: "Bearer", id_token: idToken });
  }
  return new Response("not found", { status: 404 });
}

const FREEE_ACCOUNTS = "https://accounts.secure.freee.co.jp";
const FREEE = { tokenPath: "/public_api/token", client: { id: "freee-client", secret: "freee-secret" } };
const ENTRA = "https://login.microsoftonline.com";
const GRAPH = {
  tokenPath: "/REPLACE_WITH_TENANT_ID/oauth2/v2.0/token",
  client: { id: "graph-client", secret: "graph-secret" },
  requireScope: true,
};
const GOOGLE_OAUTH = "https://oauth2.googleapis.com";
const DOCS = { tokenPath: "/token", client: { id: "docs-client", secret: "docs-secret" } };
const usedRefreshTokens = new Set<string>();
const refreshCalls = new Map<string, number>();

// A fake OAuth server for freee, Entra, and Google. The authorization code is base64url
// JSON of { challenge, tokens }: the token response to return once the PKCE
// check passes. Refresh tokens rotate; "revoked-*" is refused, "down-*" fails,
// and "short-*" yields an access token that is already expired. With
// `requireScope`, a refresh must send the scopes again, as Entra expects.
async function oauthServer(
  request: Request,
  server: { tokenPath: string; client: { id: string; secret: string }; requireScope?: boolean },
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/stats") return Response.json({ calls: refreshCalls.get(url.searchParams.get("rt") ?? "") ?? 0 });
  if (url.pathname !== server.tokenPath || request.method !== "POST") return new Response("not found", { status: 404 });
  const form = new URLSearchParams(await request.text());
  if (form.get("client_id") !== server.client.id || form.get("client_secret") !== server.client.secret) {
    return Response.json({ error: "invalid_client" }, { status: 401 });
  }
  if (form.get("grant_type") === "authorization_code") {
    const { challenge, tokens } = JSON.parse(Buffer.from(form.get("code")!, "base64url").toString());
    const verifier = form.get("code_verifier") ?? "";
    if (createHash("sha256").update(verifier).digest("base64url") !== challenge || !form.get("redirect_uri")) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    return Response.json(tokens);
  }
  if (form.get("grant_type") === "refresh_token") {
    const rt = form.get("refresh_token") ?? "";
    refreshCalls.set(rt, (refreshCalls.get(rt) ?? 0) + 1);
    await sleep(50);
    if (server.requireScope && !form.get("scope")?.split(" ").includes("offline_access")) return Response.json({ error: "invalid_scope" }, { status: 400 });
    if (rt.startsWith("down-")) return new Response("unavailable", { status: 503 });
    if (rt.startsWith("revoked-") || usedRefreshTokens.has(rt)) return Response.json({ error: "invalid_grant" }, { status: 400 });
    usedRefreshTokens.add(rt);
    return Response.json({ access_token: `access-after-${rt}`, refresh_token: `next-${rt}`, expires_in: rt.startsWith("short-") ? 0 : 21600, token_type: "bearer" });
  }
  return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
}

// Stands in for every upstream API: echoes the request it received.
async function upstream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin === IDP) return idp(request);
  if (url.origin === FREEE_ACCOUNTS) return oauthServer(request, FREEE);
  if (url.origin === ENTRA) return oauthServer(request, GRAPH);
  if (url.origin === GOOGLE_OAUTH) return oauthServer(request, DOCS);
  if (url.pathname === "/redirect") {
    return new Response(null, { status: 302, headers: { location: "https://download.example.com/file" } });
  }
  if (url.pathname === "/binary") {
    return new Response(await request.arrayBuffer(), {
      headers: { "content-type": "application/octet-stream", "set-cookie": "upstream=1" },
    });
  }
  return Response.json(
    {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    },
    { headers: { "set-cookie": "upstream=1", "x-upstream": "yes" } },
  );
}

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: CONFIG },
      miniflare: {
        bindings: {
          SERVICES,
          SIGNING_KEY: "test-signing-key-test-signing-key-0123456789",
          ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          OIDC_CLIENT_SECRET: "test",
          OIDC_ISSUER,
          OIDC_CLIENT_ID,
          ALLOWED_TENANTS: "tenant-1",
          OAUTH_FREEE_CLIENT_ID: FREEE.client.id,
          OAUTH_FREEE_CLIENT_SECRET: FREEE.client.secret,
          OAUTH_GRAPH_CLIENT_ID: GRAPH.client.id,
          OAUTH_GRAPH_CLIENT_SECRET: GRAPH.client.secret,
          OAUTH_DOCS_CLIENT_ID: DOCS.client.id,
          OAUTH_DOCS_CLIENT_SECRET: DOCS.client.secret,
        },
        outboundService: upstream,
      },
    }),
  ],
});
